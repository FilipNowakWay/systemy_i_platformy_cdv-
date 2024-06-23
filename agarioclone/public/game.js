const canvas = document.getElementById('gameCanvas');
const context = canvas.getContext('2d');
canvas.width = window.innerWidth; // Keep canvas size as the window size
canvas.height = window.innerHeight; // Keep canvas size as the window size

const winsDisplay = document.getElementById('winsDisplay');

const CANVAS_WIDTH = 2000; // Increased width
const CANVAS_HEIGHT = 2000; // Increased height

let players = {};
let food = [];
let localPlayerId = null;
let gameOver = false;

let targetX = CANVAS_WIDTH / 2;
let targetY = CANVAS_HEIGHT / 2;

const ws = new WebSocket(`ws://${window.location.host}`);

ws.onopen = () => {
    console.log('Connected to the server');
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'init') {
        localPlayerId = data.id;
        players = data.players;
        food = data.food;
        winsDisplay.innerText = `Wins: ${players[localPlayerId].wins}`;
        console.log('Initialized with ID:', localPlayerId);
    } else if (data.type === 'update') {
        players = data.players;
        food = data.food;
        if (localPlayerId in players) {
            winsDisplay.innerText = `Wins: ${players[localPlayerId].wins}`;
        }
    } else if (data.type === 'win') {
        if (data.id === localPlayerId) {
            alert('You won! The game will restart.');
        } else {
            alert(`${players[data.id].name} won! The game will restart.`);
        }
        gameOver = true;
    } else if (data.type === 'reset') {
        players = data.players;
        food = data.food;
        gameOver = false;
        document.getElementById('loginForm').style.display = 'flex';
        canvas.style.display = 'none';
    }
};

ws.onclose = () => {
    console.log('Disconnected from server');
};

window.addEventListener('mousemove', (event) => {
    if (gameOver) return;
    const rect = canvas.getBoundingClientRect();
    targetX = (event.clientX - rect.left) * (CANVAS_WIDTH / canvas.width);
    targetY = (event.clientY - rect.top) * (CANVAS_HEIGHT / canvas.height);

    // Send the target position to the server
    ws.send(JSON.stringify({ id: localPlayerId, x: targetX, y: targetY }));
});

function login() {
    const name = document.getElementById('nameInput').value;
    if (!name) {
        alert('Please enter your name');
        return;
    }

    fetch('/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
    })
    .then(response => response.json())
    .then(data => {
        localPlayerId = data.id;
        players = data.players;
        food = data.food;
        winsDisplay.innerText = `Wins: ${data.wins}`;
        ws.send(JSON.stringify({ type: 'init', id: localPlayerId }));
        document.getElementById('loginForm').style.display = 'none';
        canvas.style.display = 'block';
        winsDisplay.style.display = 'block';
        draw();
    })
    .catch(error => {
        console.error('Error:', error);
    });
}

function drawPlayer(player) {
    context.beginPath();
    context.arc(player.x * (canvas.width / CANVAS_WIDTH), player.y * (canvas.height / CANVAS_HEIGHT), player.radius, 0, Math.PI * 2);
    context.fillStyle = player.color;
    context.fill();
    context.closePath();
    context.fillStyle = 'black';
    context.fillText(player.name, (player.x - player.radius) * (canvas.width / CANVAS_WIDTH), (player.y - player.radius - 10) * (canvas.height / CANVAS_HEIGHT));
    context.fillText(`Score: ${player.score}`, (player.x - player.radius) * (canvas.width / CANVAS_WIDTH), (player.y - player.radius - 20) * (canvas.height / CANVAS_HEIGHT));
}

function drawFood(foodItem) {
    context.beginPath();
    context.arc(foodItem.x * (canvas.width / CANVAS_WIDTH), foodItem.y * (canvas.height / CANVAS_HEIGHT), foodItem.radius, 0, Math.PI * 2);
    context.fillStyle = foodItem.color;
    context.fill();
    context.closePath();
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function updatePlayerPosition() {
    if (localPlayerId && players[localPlayerId]) {
        const player = players[localPlayerId];
        player.x = lerp(player.x, targetX, 0.1);
        player.y = lerp(player.y, targetY, 0.1);

        // Send the player's updated position to the server
        ws.send(JSON.stringify({ id: localPlayerId, x: player.x, y: player.y }));
    }
}

function draw() {
    if (gameOver) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    food.forEach(drawFood);
    for (let id in players) {
        if (players[id]) {
            drawPlayer(players[id]);
        }
    }
    updatePlayerPosition();
    requestAnimationFrame(draw);
}


draw();
