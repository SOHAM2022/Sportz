import WebSocket, {WebSocketServer} from "ws";
import {wsArcjet} from "../src/arcjet.js";

function sendJson(socket,payload){
    if(socket.readyState !== WebSocket.OPEN) {
        return;
    }
    socket.send(JSON.stringify(payload));
}

function broadcast(wss,payload){
    for(const client of wss.clients){
        if(client.readyState === WebSocket.OPEN) {
            sendJson(client,payload);
        }
    }

}

export function attachWebSocketServer(server){
    const wss = new WebSocketServer({
        noServer: true,
        maxPayload:1024*1024
    })

    server.on('upgrade', async (req, socket, head) => {
        if (req.url !== '/ws') {
            socket.destroy();
            return;
        }

        if (wsArcjet) {
            try {
                const decision = await wsArcjet.protect(req);
                if (decision.isDenied()) {
                    const status = decision.reason.isRateLimit() ? '429 Too Many Requests' : '403 Forbidden';
                    socket.write(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\n\r\n`);
                    socket.destroy();
                    return;
                }
            } catch (e) {
                console.error('Arcjet WS protection error:', e);
                socket.write('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n');
                socket.destroy();
                return;
            }
        }

        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });

    wss.on('connection',(socket)=>{
        socket.isAlive = true;
        socket.on('pong', () => { socket.isAlive = true; });

        sendJson(socket,{type:'welcome'});

        socket.on('error',(e)=>{
            console.error('WebSocket error:',e);
        })
    });

    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.isAlive === false) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', () => clearInterval(interval));

    function broadcastMatchCreated(match){
        broadcast(wss,{type:'match_created',data:match});
    }

    return {broadcastMatchCreated};
}