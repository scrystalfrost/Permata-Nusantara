require('dotenv').config();
const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');

const app = express();
app.use(cors());
app.use(express.json());

// --- KONFIGURASI 2 PAYMENT GATEWAY MIDTRANS ---

// 1. Gateway SSKKI (Untuk Donasi >= 1 Juta - Dapat Tanda Terima Resmi)
let snapSSKKI = new midtransClient.Snap({
    isProduction : false, 
    serverKey : process.env.MIDTRANS_SERVER_KEY_SSKKI || 'SB-Mid-server-vXKswQYddoiV7qPjQw_2O~c~' 
});

// 2. Gateway Operasional (Untuk Donasi < 1 Juta - Tanpa Tanda Terima Resmi)
let snapOperasional = new midtransClient.Snap({
    isProduction : false, 
    serverKey : process.env.MIDTRANS_SERVER_KEY_OPERASIONAL || 'SB-Mid-server-UGr7lv~4jMOe.MMzM8mBgbZB' 
});

// Endpoint untuk meminta token pembayaran ke Midtrans
app.post('/api/get-token', async (req, res) => {
    try {
        const { name, email, phone, amount, meters } = req.body;
        
        // Menyiapkan parameter transaksi
        let parameter = {
            "transaction_details": {
                "order_id": `DONASI-LAHAN-${Date.now()}`,
                "gross_amount": amount
            },
            "customer_details": {
                "first_name": name,
                "email": email,
                "phone": phone
            },
            "item_details": [{
                "id": `LAHAN-${meters}M`,
                "price": amount,
                "quantity": 1,
                "name": `Pembebasan Lahan ${meters} m² (All-In)`
            }]
        };

        let transaction;
        let gatewayType;

        // Logika Pemilihan Gateway Berdasarkan Nominal
        if (amount >= 1000000) {
            // Gunakan Gateway SSKKI untuk donasi >= 1 Juta
            transaction = await snapSSKKI.createTransaction(parameter);
            gatewayType = 'SSKKI';
        } else {
            // Gunakan Gateway Operasional untuk donasi < 1 Juta
            transaction = await snapOperasional.createTransaction(parameter);
            gatewayType = 'Operasional';
        }

        // Kirimkan token dan info gateway yang digunakan ke frontend
        res.json({ 
            token: transaction.token,
            gateway: gatewayType 
        });

    } catch (error) {
        console.error("Gagal membuat transaksi:", error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;

// Hanya jalankan listen secara lokal jika bukan di production Vercel
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server Backend berjalan di port ${PORT}`);
    });
}

// Export app agar bisa dieksekusi oleh sistem Serverless Vercel
module.exports = app;