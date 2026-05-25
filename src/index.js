import express from "express";
import AgentAPI from "apminsight";
AgentAPI.config();
import "dotenv/config";
import { matchRouter } from "./routes/matches.js";
import { commentaryRouter } from "./routes/commentary.js";
import http from "http";
import {attachWebSocketServer} from "../ws/server.js";
import {securityMiddleware} from "./arcjet.js";

const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || "0.0.0.0";

const app = express();
const server = http.createServer(app);

app.use(express.json());

app.use(securityMiddleware())

app.get("/", (req, res) => {
  res.json({ message: "Welcome to the Real-Time Sports Dashboard API" });
});

app.use("/matches", matchRouter);
app.use("/matches/:id/commentary", commentaryRouter);

// initialize websocket server
const { broadcastMatchCreated, broadcastCommentary } = attachWebSocketServer(server);
app.locals.broadcastMatchCreated = broadcastMatchCreated;
app.locals.broadcastCommentary = broadcastCommentary;

server.listen(PORT,HOST, () => {
  const baseUrl = HOST === "0.0.0.0" ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log(`WebSocket server is running at ${baseUrl.replace('http','ws')}/ws`);
});
