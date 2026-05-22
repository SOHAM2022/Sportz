import express from "express";
import "dotenv/config";
import { matchRouter } from "./routes/matches.js";
import http from "http";
import {attachWebSocketServer} from "../ws/server.js";

const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || "0.0.0.0";

const app = express();
const server = http.createServer(app);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Welcome to the Real-Time Sports Dashboard API" });
});

app.use("/matches", matchRouter);

// initialize websocket server
const{broadcastMatchCreated} = attachWebSocketServer(server)
app.locals.broadcastMatchCreated = broadcastMatchCreated;

server.listen(PORT,HOST, () => {
  const baseUrl = HOST === "0.0.0.0" ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log(`WebSocket server is running at ${baseUrl.replace('http','ws')}/ws`);
});
