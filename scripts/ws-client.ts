// Abdullah Olcan Askar, 2024502180
const token = Deno.args[0];
if (!token) {
  console.error("usage: deno run -A scripts/ws-client.ts <token>");
  Deno.exit(1);
}

const socket = new WebSocket(`ws://localhost:8000/ws?token=${token}`);
socket.onopen = () => console.log("connected");
socket.onmessage = (event) => console.log(String(event.data));
socket.onclose = () => console.log("closed");
socket.onerror = () => console.error("websocket error");
