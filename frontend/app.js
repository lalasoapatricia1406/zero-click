// --- CONFIGURATION ---
const FLASK_URL = 'http://localhost:5000';
let PRODUCTS_DATA = [];
let productsVisible = false;
let currentSelection = null;
let sessionId = null; // ✅ session persistante pour toute la conversation

// --- INITIALISATION ---
window.addEventListener('DOMContentLoaded', () => {
    const welcomeTime = document.getElementById('welcomeTime');
    const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (welcomeTime) welcomeTime.textContent = now;

    const chatInput = document.getElementById('chatInput');
    const btnSend = document.getElementById('btnSend');

    if (chatInput && btnSend) {
        chatInput.addEventListener('input', () => {
            btnSend.disabled = chatInput.value.trim() === "";
        });

        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }

    syncProducts();
});

// --- SYNCHRONISATION DU CATALOGUE ---
async function syncProducts() {
    const countLabel = document.getElementById('productCount');
    try {
        const response = await fetch(`${FLASK_URL}/api/products`);
        const data = await response.json();

        if (data.success) {
            PRODUCTS_DATA = data.products;
            if (countLabel) countLabel.textContent = `${PRODUCTS_DATA.length} PRODUITS`;
        } else {
            if (countLabel) countLabel.textContent = "ERREUR SYNC";
        }
    } catch (error) {
        console.error("Erreur sync:", error);
        if (countLabel) countLabel.textContent = "OFFLINE";
    }
}

// --- AFFICHAGE DU CATALOGUE ---
function toggleProducts() {
    const toggle = document.getElementById('dropdownToggle');
    const list = document.getElementById('productsList');
    const empty = document.getElementById('emptyState');

    if (!toggle || !list) return;

    productsVisible = !productsVisible;
    toggle.classList.toggle('active', productsVisible);

    if (productsVisible) {
        list.classList.add('open');
        list.style.display = 'block';
        if (empty) empty.style.display = 'none';
        renderProducts();
    } else {
        list.classList.remove('open');
        list.style.display = 'none';
        if (empty) empty.style.display = 'flex';
    }
}

function renderProducts() {
    const list = document.getElementById('productsList');
    if (!list) return;
    list.innerHTML = '';

    if (PRODUCTS_DATA.length === 0) {
        list.innerHTML = `<div class="msg-system">Chargement du catalogue...</div>`;
        return;
    }

    PRODUCTS_DATA.forEach((p) => {
        const stockQty = p.stock || 0;
        const isOutOfStock = parseInt(stockQty) <= 0;

        const card = document.createElement('div');
        card.className = `product-card ${isOutOfStock ? 'out-of-stock' : ''}`;

        card.innerHTML = `
            <div class="product-info">
                <div class="product-name">${p.name}</div>
                <div class="product-price">${parseFloat(p.price).toFixed(2)} €</div>
                <div class="stock-badge ${isOutOfStock ? 'out' : (stockQty < 5 ? 'low' : 'available')}">
                    ${isOutOfStock ? '✕ RUPTURE' : '✓ EN STOCK (' + stockQty + ')'}
                </div>
            </div>
            <div class="select-group">
                <div class="select-label">VARIANTES</div>
                <select id="attr-${p.id}" ${isOutOfStock ? 'disabled' : ''}>
                    <option value="Standard">Standard</option>
                </select>
            </div>
            <div class="qty-group">
                <div class="select-label">QUANTITÉ</div>
                <div class="qty-control">
                    <button class="qty-btn" onclick="changeQty(${p.id}, -1)">-</button>
                    <div class="qty-value" id="qty-${p.id}">1</div>
                    <button class="qty-btn" onclick="changeQty(${p.id}, 1)">+</button>
                </div>
            </div>
            <button class="btn-choisir" id="btn-select-${p.id}" onclick="selectProduct(${p.id})" ${isOutOfStock ? 'disabled' : ''}>
                CHOISIR →
            </button>
        `;
        list.appendChild(card);
    });
}

function changeQty(id, delta) {
    const el = document.getElementById(`qty-${id}`);
    if (!el) return;
    let val = parseInt(el.textContent) + delta;
    if (val < 1) val = 1;
    el.textContent = val;
}

// --- LOGIQUE D'ENVOI PRODUIT ---
async function selectProduct(id) {
    const product = PRODUCTS_DATA.find(p => p.id === id);
    if (!product) return;

    const variant = document.getElementById(`attr-${id}`).value || "Standard";
    const qty = parseInt(document.getElementById(`qty-${id}`).textContent);
    const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    currentSelection = {
        id: id,
        name: product.name,
        variant: variant,
        qty: qty,
        price: product.price,
        total: (product.price * qty).toFixed(2)
    };

    const orderMessage = `COMMANDE : ${product.name} | Variante : ${variant} | Qté : ${qty}`;
    appendMessage(orderMessage, 'user', now);

    const btn = document.getElementById(`btn-select-${id}`);
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "ENVOI EN COURS...";

    await callOrderAPI(orderMessage, currentSelection, btn, originalText, now);
}

// --- LOGIQUE CHAT LIBRE ---
async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const userText = input.value.trim();
    const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    if (!userText) return;

    appendMessage(userText, 'user', now);
    input.value = '';
    document.getElementById('btnSend').disabled = true;

    await callOrderAPI(userText, currentSelection, null, null, now);
}

// --- APPEL API CENTRALISÉ ---
async function callOrderAPI(message, selection, btnEl, originalText, time) {
    const loadingId = appendLoadingMessage();

    try {
        const response = await fetch(`${FLASK_URL}/commande`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                commande:   message,
                selection:  selection,
                session_id: sessionId   // ✅ null au 1er message, rempli ensuite
            })
        });

        const result = await response.json();
        removeLoadingMessage(loadingId);

        if (response.ok && result.status === "success") {

            // ✅ Stocke le session_id renvoyé par Flask pour tous les prochains messages
            if (result.session_id) {
                sessionId = result.session_id;
                console.log(`🔑 Session active : ${sessionId}`);
            }

            setTimeout(() => {
                appendMessage(result.response || "Message bien reçu !", 'bot', time);
                clearSelection();
            }, 400);

        } else {
            appendMessage(
                result.response || "Erreur lors de la communication avec l'assistant.",
                'bot',
                time
            );
        }

    } catch (error) {
        console.error("Erreur API:", error);
        removeLoadingMessage(loadingId);
        appendMessage("Connexion au serveur impossible. Vérifiez que Flask est lancé.", 'bot', time);
    } finally {
        if (btnEl) {
            btnEl.disabled = false;
            btnEl.innerText = originalText;
        }
    }
}

// --- FONCTIONS UTILITAIRES ---
function appendMessage(text, side, time) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const msgDiv = document.createElement('div');
    msgDiv.className = `msg ${side}`;
    msgDiv.innerHTML = `
        <div class="msg-content">${text}</div>
        <div class="msg-time">${time}</div>
    `;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
}

function appendLoadingMessage() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return null;

    const id = 'loading-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.className = 'msg bot';
    msgDiv.id = id;
    msgDiv.innerHTML = `<div class="msg-content msg-loading">...</div>`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
    return id;
}

function removeLoadingMessage(id) {
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.remove();
}

function clearSelection() {
    currentSelection = null;
}