import requests
import uuid
import os
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# --- CONFIGURATION ---
PRESTASHOP_URL = "https://www.passioncampagne9.projets-omega.net/api"
API_KEY = "9DZICA5S66TNKDE1XLFJ3LGYU4P8BKX1"
N8N_WEBHOOK_URL = "https://n8n.projets-omega.net/webhook-test/commande"  # ✅ /webhook/ et non /webhook-test/


@app.route('/api/products', methods=['GET'])
def get_products():
    """Récupère les produits et leurs stocks depuis PrestaShop"""
    try:
        url_p = f"{PRESTASHOP_URL}/products?display=[id,name,price]&output_format=JSON"
        res_p = requests.get(url_p, auth=(API_KEY, ''), timeout=10)

        url_s = f"{PRESTASHOP_URL}/stock_availables?display=[id_product,quantity]&output_format=JSON"
        res_s = requests.get(url_s, auth=(API_KEY, ''), timeout=10)

        if res_p.status_code == 200:
            products = res_p.json().get('products', [])
            stocks = res_s.json().get('stock_availables', []) if res_s.status_code == 200 else []

            stock_map = {str(s['id_product']): s['quantity'] for s in stocks}

            clean_products = []
            for p in products:
                p_id = str(p['id'])
                name = p.get('name', 'Produit sans nom')
                if isinstance(name, list) and len(name) > 0:
                    name = name[0].get('value', 'Produit sans nom')

                clean_products.append({
                    "id": p['id'],
                    "name": name,
                    "price": round(float(p.get('price', 0)), 2),
                    "stock": int(stock_map.get(p_id, 0))
                })

            print(f"✅ {len(clean_products)} produits chargés depuis PrestaShop.")
            return jsonify({"success": True, "products": clean_products})

        return jsonify({"success": False, "error": f"Erreur PrestaShop: {res_p.status_code}"}), 500

    except Exception as e:
        print(f"❌ Erreur Catalogue: {str(e)}")
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/commande", methods=["POST"])
def commande():
    """Relais entre le Chat et n8n"""
    data = request.json

    if not data or "commande" not in data:
        return jsonify({"status": "error", "response": "Données manquantes"}), 400

    # ✅ CORRECTION : conserve le session_id envoyé par le frontend
    # ou en génère un nouveau uniquement si absent ou vide
    session_id = data.get("session_id")
    if not session_id:
        session_id = "sess_" + str(uuid.uuid4())[:8]
        print(f"🆕 Nouvelle session créée : {session_id}")
    else:
        print(f"🔄 Session existante réutilisée : {session_id}")

    # Construction du payload pour n8n
    payload = {
        "commande":   data["commande"],
        "session_id": session_id,                    # ✅ toujours présent
        "selection":  data.get("selection", None),   # optionnel
    }

    try:
        r = requests.post(N8N_WEBHOOK_URL, json=payload, timeout=30)

        if r.status_code == 200:
            content_type = r.headers.get('Content-Type', '')

            if 'application/json' in content_type:
                n8n_res = r.json()
                if isinstance(n8n_res, list):
                    n8n_res = n8n_res[0]
                # ✅ cherche la réponse dans les clés possibles de n8n
                bot_text = (
                    n8n_res.get("reply") or
                    n8n_res.get("response") or
                    n8n_res.get("output") or
                    "Message reçu."
                )
            else:
                bot_text = r.text or "Message reçu."

            return jsonify({
                "status":     "success",
                "response":   bot_text,
                "session_id": session_id,   # ✅ renvoyé au frontend pour les prochains messages
            })

        return jsonify({
            "status":   "error",
            "response": f"n8n a répondu avec l'erreur {r.status_code}"
        }), r.status_code

    except requests.exceptions.Timeout:
        print("❌ Timeout n8n")
        return jsonify({"status": "error", "response": "Le serveur n8n met trop de temps à répondre."}), 504

    except Exception as e:
        print(f"❌ Erreur Webhook n8n: {str(e)}")
        return jsonify({"status": "error", "response": "Le serveur n8n est injoignable."}), 500


if __name__ == '__main__':
    app.run(port=5000, debug=True)