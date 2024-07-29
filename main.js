const keys = forge.pki.rsa.generateKeyPair(2048);
const publicKeyText = forge.pki.publicKeyToPem(keys.publicKey);
const params = new URLSearchParams(location.search);
const peerInstance = new Peer();
const connections = [];
let myUUID;
let passphrase;

function p2pFetch(peerId, request, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const requestId = performance.now();

    const checkResponse = ev => {
      const responseFetch = ev.detail;
      if (responseFetch.requestId === requestId) {
        document.removeEventListener('p2pResponse', checkResponse);
        resolve(ev.detail.response);
      }
    };

    document.addEventListener('p2pResponse', checkResponse);
    connections[peerId].peerConn.send({ request, requestId });

    setTimeout(() => {
      reject(new Error("Tempo limite excedido"));
    }, timeout);
  });
}

function copyLink() {
  document.body.focus();
  navigator.clipboard.writeText(
    `${location.origin}${location.pathname}?user=${myUUID}`
  );
}

function updateCert(peer, publicKey) {
  console.log("Atualizando certificado")
  connections[peer].crypt = publicKey;
}

function encodeBase64Unicode(str) {
  const utf8Bytes = new TextEncoder().encode(str);
  const base64String = btoa(String.fromCharCode(...utf8Bytes));
  return base64String;
}

function decodeBase64Unicode(base64) {
  const binaryString = atob(base64);
  const utf8Bytes = Uint8Array.from(binaryString, char => char.charCodeAt(0));
  const decodedString = new TextDecoder().decode(utf8Bytes);
  return decodedString;
}

function encryptWithAES(text) {
  const key = forge.pkcs5.pbkdf2(passphrase, "salt", 1000, 16);
  const cipher = forge.cipher.createCipher("AES-CBC", key);
  const iv = forge.random.getBytesSync(16);
  cipher.start({iv: iv});
  cipher.update(forge.util.createBuffer(text));
  cipher.finish();
  const encrypted = iv + cipher.output.getBytes();
  return forge.util.encode64(encrypted);
}

function decryptWithAES(encryptedText) {
  const key = forge.pkcs5.pbkdf2(passphrase, "salt", 1000, 16);
  const encryptedBytes = forge.util.decode64(encryptedText);
  const iv = encryptedBytes.slice(0, 16);
  const encrypted = encryptedBytes.slice(16);
  const decipher = forge.cipher.createDecipher("AES-CBC", key);
  decipher.start({iv: iv});
  decipher.update(forge.util.createBuffer(encrypted));
  decipher.finish();
  return decipher.output.toString();
}

function drawUserMessage(message, me=false) {
  const div = document.createElement("div");
  div.innerHTML = message;
  div.className = `message ${me ? "me" : "other-user"}`;

  chatMessage.appendChild(div);
  chatMessage.scrollTop = chatMessage.scrollHeight;
}

statusLoad.innerHTML = `Gerando UUID...`;
document.addEventListener("DOMContentLoaded", () => {
  peerInstance.on("open", function(uuid) {
    statusLoad.innerHTML = `Gerando link...`;
    myUUID = uuid;
    statusLoad.innerHTML = `Esperando frase-senha...`;
    passphrase = prompt("Digite sua frase secreta: ");
    statusLoad.innerHTML = `Link Copiado`;
    statusLoad.innerHTML = params.get("user")
      ? "Se conectando..."
      : `<button class="myLink" onclick="copyLink()">Copiar meu link</button> Esparando segundo usuário...`;
    if (params.get("user")) {
      const connWithOtherUser = peerInstance.connect(params.get("user"));
      connections[params.get("user")] = { peerConn: connWithOtherUser };
      setTimeout(() => {
        connWithOtherUser.send({
          message: "Conectado",
          publicKeyText: encryptWithAES(publicKeyText)
        });
      }, 1e3);
    }
  });

  peerInstance.on("close", function () {
    statusLoad.innerHTML = `Sua conexão caiu...`;
    loading.style.display = "flex";
  });

  peerInstance.on("connection", function (conn) {
    conn.on("open", function() {
      console.log("Conectado a: ", conn);
      if (!connections[conn.peer]) {
        const connWithOtherUser = peerInstance.connect(conn.peer);
        connections[conn.peer] = { peerConn: connWithOtherUser };

        setTimeout(() => {
          connWithOtherUser.send({
            message: "Conectado",
            publicKeyText: encryptWithAES(publicKeyText)
          });
        }, 1e3);
      }

      conn.on("data", function (data) {
        document.dispatchEvent(new CustomEvent('p2pResponse', {
          detail: data
        }));
        if (data.request) {
          const userConn = connections[conn.peer].peerConn;
          if (data.request === "needCertificate") 
            userConn.send({
              response: encryptWithAES(publicKeyText),
              requestId: data.requestId
            });
        } else if (data.publicKeyText) {
          statusLoad.innerHTML = `Lendo o certificado...`;
          const decryptCert = decryptWithAES(data.publicKeyText);
          updateCert(conn.peer, forge.pki.publicKeyFromPem(decryptCert));
          statusLoad.innerHTML = `Abrindo o chat...`;
          loading.style.display = "none";
        } else if (data.message) {
          if (!data.publicKeyText) {
            statusLoad.innerHTML = `Abrindo o chat...`;
            loading.style.display = "none";
            const messageDecrypt = keys.privateKey.decrypt(data.message);
            const decodedString = decodeBase64Unicode(messageDecrypt);
            drawUserMessage(decodedString, false);
          }
        }
      });
    });

    conn.on("close", function() {
      delete connections[conn.peer];
      console.log("Conexão fechada: ", conn.peer);
      statusLoad.innerHTML = `Conexão fechada...<br>Esparando segundo usuário...`;
      loading.style.display = "flex";
    });
  });
});

function sendMessage(messageData) {
  Object.values(connections).forEach(async conn => {
    if (!conn.crypt) { // Get certificate
      const publicKeyText = await p2pFetch(conn.peer, "needCertificate");
      statusLoad.innerHTML = `Lendo o certificado...`;
      const decryptCert = decryptWithAES(publicKeyText);
      conn.crypt = forge.pki.publicKeyFromPem(decryptCert);
      updateCert(conn.peer, conn.crypt);
    }
    const messageDataCrypt = conn.crypt.encrypt(messageData);
    conn.peerConn.send({
      message: messageDataCrypt
    });
  });
}

formMessage.onsubmit = function(ev) {
  ev.preventDefault();
  ev.stopPropagation();

  const encondeText = encodeBase64Unicode(message.value);

  sendMessage(encondeText);
  drawUserMessage(message.value, true);

  message.value = "";
}

window.onerror = (ev) => {
  statusLoad.innerHTML = "Falha na leitura do certificado...";
  alert(String(ev))
}
