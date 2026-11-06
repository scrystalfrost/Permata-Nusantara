require('dotenv').config();
const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');

const { createClient } = require('@supabase/supabase-js');

// Inisialisasi koneksi ke Database Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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

// ==========================================
// 1. API PEMBACA PROGRES DONASI
// ==========================================
app.get('/api/progress', async (req, res) => {
    try {
        // Ambil semua transaksi yang lunas dari Supabase
        const { data, error } = await supabase
            .from('transaksi')
            .select('luas_meter')
            .eq('status', 'LUNAS');
            
        if (error) throw error;
        
        // Hitung total meter yang terkumpul
        const totalTerkumpul = data.reduce((sum, item) => sum + Number(item.luas_meter), 0);
        const totalRupiah = totalTerkumpul * 850000;
        
        res.json({
            terkumpul_meter: totalTerkumpul,
            terkumpul_rupiah: totalRupiah,
            target_meter: 1431,
            target_rupiah: 1431 * 850000
        });
    } catch (error) {
        console.error("Progress error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 2. WEBHOOK MIDTRANS (Penerima Notifikasi)
// ==========================================
app.post('/api/webhook', async (req, res) => {
    try {
        const data = req.body;
        
        // Cek apakah donatur sudah berhasil bayar lunas
        if (data.transaction_status === 'settlement' || data.transaction_status === 'capture') {
            
            // Hitung luas meter dari nominal gross_amount (karena harga Rp850.000/m2)
            const luasMeter = parseFloat(data.gross_amount) / 850000;
            
            // Simpan otomatis ke Database Supabase
            const { error } = await supabase
                .from('transaksi')
                .upsert({
                    order_id: data.order_id,
                    luas_meter: luasMeter,
                    status: 'LUNAS'
                });

            if (error) {
                console.error('Error simpan ke Supabase:', error);
            } else {
                console.log(`Donasi ${luasMeter} m² (Order: ${data.order_id}) berhasil dicatat!`);
            }
        }
        
        // Wajib balas 200 OK agar Midtrans tahu pesan sudah kita terima
        res.status(200).send('OK');
    } catch (error) {
        console.error("Webhook error:", error);
        res.status(500).send('Error');
    }
});

// Export app agar bisa dieksekusi oleh sistem Serverless Vercel
module.exports = app;