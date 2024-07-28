const keys = forge.pki.rsa.generateKeyPair(2048);
const publicKeyText = forge.pki.publicKeyToPem(keys.publicKey);
const params = new URLSearchParams(location.search);
const peerInstance = new Peer();
const connections = [];

function updateCert(peer, publicKey) {
  console.log("Atualizando certificado")
  connections[peer].crypt = publicKey;
}

function drawUserMessage(message, me=false) {
  const div = document.createElement("div");
  div.innerHTML = message;
  div.className = `message ${me ? "me" : "other-user"}`;

  chatMessage.appendChild(div);
  // add scroll after
}

document.addEventListener("DOMContentLoaded", ev => {
  peerInstance.on("open", function(uuid) {
    alert(`Seu link de acesso é: ${location.origin}?user=${uuid}`);

    if (params.get("user")) {
      const connWithOtherUser = peerInstance.connect(params.get("user"));
      connections[params.get("user")] = { peerConn: connWithOtherUser };
      setTimeout(() => {
        connWithOtherUser.send({
          message: "Conectado",
          publicKeyText: publicKeyText
        });
      }, 1e3);
    }
  });

  peerInstance.on("close", function () {
    alert(`Sua conexão caiu`);
  });

  peerInstance.on("connection", function (conn) {
    conn.on("data", function (data) {
      if (data.publicKeyText) {
        updateCert(conn.peer, forge.pki.publicKeyFromPem(data.publicKeyText));
      } else if (data.message) {
        console.log("Mensagem recebida", data.message);
        if (!data.publicKeyText) {
          const messageDecrypt = keys.privateKey.decrypt(data.message);
          drawUserMessage(messageDecrypt, false);
        }
      }
    });

    conn.on("open", function() {
      console.log("Conectado a: ", conn);
      if (!connections[conn.peer]) {
        const connWithOtherUser = peerInstance.connect(conn.peer);
        connections[conn.peer] = { peerConn: connWithOtherUser };

        setTimeout(() => {
          connWithOtherUser.send({
            message: "Conectado",
            publicKeyText: publicKeyText
          });
        }, 1e3);
      }
    });

    conn.on("close", function() {
      delete connections[conn.peer];
      console.log("Conexão fechada: ", conn.peer);
    });
  });
});

function sendMessage(messageData) {
  Object.values(connections).forEach(conn => {
    const messageDataCrypt = conn.crypt.encrypt(messageData);
    conn.peerConn.send({
      message: messageDataCrypt
    });
  });
}

formMessage.onsubmit = function(ev) {
  ev.preventDefault();
  ev.stopPropagation();

  sendMessage(message.value);
  drawUserMessage(message.value, true);

  message.value = "";
}