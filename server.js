require('dotenv').config();
const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- KONFIGURASI 1 PAYMENT GATEWAY (Hanya untuk Segmen 1 / Tanpa SPT) ---
let snap = new midtransClient.Snap({
    isProduction : false, // Ubah ke true jika sudah live
    serverKey : process.env.MIDTRANS_SERVER_KEY // Hanya butuh 1 Key
});

// Endpoint untuk meminta token pembayaran ke Midtrans
app.post('/api/get-token', async (req, res) => {
    try {
        const { name, email, phone, amount, meters } = req.body;
        
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

        // Langsung generate transaksi tanpa pengecekan if-else
        let transaction = await snap.createTransaction(parameter);
        res.json({ token: transaction.token });

    } catch (error) {
        console.error("Gagal membuat transaksi:", error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Server Backend berjalan di port ${PORT}`));
}

// ==========================================
// 1. API PEMBACA PROGRES DONASI
// ==========================================
app.get('/api/progress', async (req, res) => {
    try {
        const { data, error } = await supabase.from('transaksi').select('luas_meter').eq('status', 'LUNAS');
        if (error) throw error;
        const totalTerkumpul = data.reduce((sum, item) => sum + Number(item.luas_meter), 0);
        res.json({
            terkumpul_meter: totalTerkumpul,
            terkumpul_rupiah: totalTerkumpul * 800000,
            target_meter: 2805,
            target_rupiah: 2805 * 800000
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 2. WEBHOOK MIDTRANS
// ==========================================
app.post('/api/webhook', async (req, res) => {
    try {
        const data = req.body;
        if (data.transaction_status === 'settlement' || data.transaction_status === 'capture') {
            const luasMeter = parseFloat(data.gross_amount) / 800000;
            const { error } = await supabase.from('transaksi').upsert({
                order_id: data.order_id, luas_meter: luasMeter, status: 'LUNAS'
            });
            if (error) console.error('Error simpan:', error);
        }
        res.status(200).send('OK');
    } catch (error) {
        res.status(500).send('Error');
    }
});

// ==========================================
// 3. API UPLOAD BUKTI TRANSFER (TANPA FONNTE)
// ==========================================
app.post('/api/submit-tax-donation', async (req, res) => {
    try {
        const { fileName, fileType, fileBase64 } = req.body;
        let publicFileUrl = 'Gagal memuat link bukti transfer';

        if (fileBase64) {
            const base64Data = fileBase64.replace(/^data:.*;base64,/, '');
            const fileBuffer = Buffer.from(base64Data, 'base64');
            const uniqueFileName = `bukti_${Date.now()}_${fileName.replace(/\s+/g, '_')}`;

            const { error: uploadError } = await supabase.storage
                .from('bukti-transfer')
                .upload(uniqueFileName, fileBuffer, { contentType: fileType, upsert: true });

            if (!uploadError) {
                const { data: urlData } = supabase.storage.from('bukti-transfer').getPublicUrl(uniqueFileName);
                publicFileUrl = urlData.publicUrl;
            }
        }
        // Hanya kembalikan link file ke frontend, tidak memanggil Fonnte
        res.status(200).json({ success: true, fileUrl: publicFileUrl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = app;