const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const bodyParser = require('body-parser');
const mysql = require('mysql');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;
const CANVAS_WIDTH = 2000;
const CANVAS_HEIGHT = 2000;
const NUM_FOOD_ITEMS = 100;
const WIN_SCORE = 700;

const db = mysql.createConnection({
    host: 'localhost',
    user: 'agario_user',
    password: 'securepassword',
    database: 'agario'
});

db.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
    } else {
        console.log('Connected to MySQL');
    }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

let players = {};
let food = [];
let gameInProgress = false;
let winningPlayerId = null;

function createFood() {
    food = [];
    for (let i = 0; i < NUM_FOOD_ITEMS; i++) {
        food.push({
            x: Math.random() * CANVAS_WIDTH,
            y: Math.random() * CANVAS_HEIGHT,
            radius: 5,
            color: getRandomColor()
        });
    }
}

function spawnPlayer(name, wins) {
    let x = Math.random() * CANVAS_WIDTH;
    let y = Math.random() * CANVAS_HEIGHT;
    return { x, y, radius: 20, color: getRandomColor(), name, score: 0, wins };
}

function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

function checkCollision(player, item) {
    const dx = player.x - item.x;
    const dy = player.y - item.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < player.radius + item.radius;
}

function resetGame() {
    players = {};
    createFood();
    gameInProgress = false;
    winningPlayerId = null;
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'reset', players, food }));
        }
    });
}

app.post('/login', (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).send('Name is required');
    }

    db.query('SELECT * FROM players WHERE name = ?', [name], (err, results) => {
        if (err) {
            return res.status(500).send('Error querying database');
        }

        let player;
        if (results.length === 0) {
            db.query('INSERT INTO players (name) VALUES (?)', [name], (err, result) => {
                if (err) {
                    return res.status(500).send('Error inserting into database');
                }

                player = spawnPlayer(name, 0);
                const id = result.insertId;
                players[id] = player;
                res.json({ id, players, food, wins: 0 });
            });
        } else {
            const playerData = results[0];
            player = spawnPlayer(name, playerData.wins);
            const id = playerData.id;
            players[id] = player;
            res.json({ id, players, food, wins: player.wins });
        }
    });
});

wss.on('connection', (ws) => {
    let id = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        if (data.type === 'init') {
            id = data.id;
            gameInProgress = true;
            ws.send(JSON.stringify({ type: 'init', id, players, food }));
        } else if (players[data.id] && gameInProgress) {
            players[data.id].x = data.x;
            players[data.id].y = data.y;

            // Check for food collisions
            for (let i = food.length - 1; i >= 0; i--) {
                if (checkCollision(players[data.id], food[i])) {
                    players[data.id].radius += 1;
                    players[data.id].score += 1;
                    food.splice(i, 1); // Remove the food item
                    food.push({
                        x: Math.random() * CANVAS_WIDTH,
                        y: Math.random() * CANVAS_HEIGHT,
                        radius: 5,
                        color: getRandomColor()
                    }); // Add a new food item
                }
            }

            // Check if the player has won
            if (players[data.id].score >= WIN_SCORE && winningPlayerId === null) {
                winningPlayerId = data.id;
                const playerToUpdate = players[data.id];

                db.query('UPDATE players SET wins = wins + 1 WHERE id = ?', [data.id], (err) => {
                    if (err) {
                        console.error('Error updating wins in database:', err);
                    } else {
                        playerToUpdate.wins += 1; // Update the player's wins in memory

                        // Broadcast the win to all clients
                        wss.clients.forEach((client) => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: 'win', id: data.id }));
                            }
                        });

                        // Reset the game
                        resetGame();
                    }
                });
                return;
            }

            // Broadcast the updated player and food positions to all clients
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'update', players, food }));
                }
            });
        } else {
            console.error(`Player with id ${data.id} not found or game not in progress`);
        }
    });

    ws.on('close', () => {
        if (id) {
            console.log('Client disconnected', id);
            delete players[id];

            // Broadcast the updated player list to all clients
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: 'update', players, food }));
                }
            });
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    createFood();
});
