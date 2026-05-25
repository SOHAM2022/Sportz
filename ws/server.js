import WebSocket, {WebSocketServer} from "ws";
import {wsArcjet} from "../src/arcjet.js";
const matchSubscribers = new Map();

function subscribe(socket,matchId){
    if(!matchSubscribers.has(matchId)){
        matchSubscribers.set(matchId,new Set());
    }

    matchSubscribers.get(matchId).add(socket);

}

function unsubscribe(socket,matchId){
    const subscribers = matchSubscribers.get(matchId);
    if(!subscribers) return;

    subscribers.delete(socket);
    if(subscribers.size === 0 ){
        matchSubscribers.delete(matchId);
    }
}

function cleanupSubscriptions(socket){
    for(const matchId of socket.subscriptions){
        unsubscribe(socket,matchId);
    }
}

function sendJson(socket,payload){
    if(socket.readyState !== WebSocket.OPEN) {
        return;
    }
    socket.send(JSON.stringify(payload));
}

function broadcastToAll(wss,payload){
    for(const client of wss.clients){
        if(client.readyState === WebSocket.OPEN) {
            sendJson(client,payload);
        }
    }
}

function broadcastToMatch(matchId,payload){
    const subscribers = matchSubscribers.get(matchId);

    if(!subscribers || subscribers.size === 0) return;

    const message = JSON.stringify(payload);

    for(const client of subscribers){
        if(client.readyState === WebSocket.OPEN){
            client.send(message);
        }
    }
}

function handleMessage(socket,data){
    let message;
    try {
        message = JSON.parse(data.toString());

    }catch (e){
        sendJson(socket,{type:'error',message:'invalid message'});
    }

    if(message?.type === 'subscribe' && Number.isInteger(message.matchId)){
        subscribe(socket, message.matchId);
        socket.subscriptions.add(message.matchId);
        sendJson(socket,{type:'subscribed',matchId:message.matchId});
    }

    if(message?.type === 'unsubscribe' && Number.isInteger(message.matchId)){
        unsubscribe(socket,message.matchId);
        socket.subscriptions.delete(message.matchId);
        sendJson(socket,{type:'unsubscribed',matchId:message.matchId});
    }

}

export function attachWebSocketServer(server){
    const wss = new WebSocketServer({
        noServer: true,
        maxPayload:1024*1024
    })

    server.on('upgrade', async (req, socket, head) => {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname !== '/ws') {
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

        socket.subscriptions = new Set();

        sendJson(socket,{type:'welcome'});

        socket.on('message',(data)=>{
            handleMessage(socket,data);
        })

        socket.on('error',(e)=>{
            console.error('WebSocket error:',e);
            socket.terminate();
        })

        socket.on('close',()=>{
            cleanupSubscriptions(socket);
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
        broadcastToAll(wss,{type:'match_created',data:match});
    }

    function broadcastCommentary(matchId, commentary) {
        broadcastToMatch(matchId, { type: 'commentary', data: commentary });
    }

    return { broadcastMatchCreated, broadcastCommentary };
}