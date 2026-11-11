require('dotenv').config();
const express = require('express');
const cors = require('cors');
const midtransClient = require('midtrans-client');
const { createClient } = require('@supabase/supabase-js');

// Inisialisasi Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
app.use(cors());
// Batas limit dinaikkan ke 10mb agar bisa menerima file gambar bukti transfer
app.use(express.json({ limit: '10mb' }));

// --- KONFIGURASI PAYMENT GATEWAY MIDTRANS ---
let snap = new midtransClient.Snap({
    isProduction : false, // Ubah menjadi true saat web di-online-kan dan menerima uang asli
    serverKey : process.env.MIDTRANS_SERVER_KEY 
});

// ==========================================
// 1. API GET TOKEN MIDTRANS (Segmen 1)
// ==========================================
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
                "name": `Pengadaan Lahan ${meters} m² (All-In)`
            }]
        };

        let transaction = await snap.createTransaction(parameter);
        res.json({ token: transaction.token });

    } catch (error) {
        console.error("Gagal membuat transaksi:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 2. API PEMBACA PROGRES DONASI (Progress Bar)
// ==========================================
app.get('/api/progress', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('transaksi')
            .select('luas_meter')
            .ilike('status', 'lunas');
            
        // Jika ada kendala dari Supabase, cetak detailnya ke terminal dan hentikan proses
        if (error) {
            console.error("Detail Error Supabase:", error.message || error);
            return res.status(500).json({ error: error.message });
        }
        
        // Gunakan pengaman (data || []) agar tidak crash jika data kosong/null
        const safeData = data || [];
        const totalTerkumpul = safeData.reduce((sum, item) => sum + Number(item.luas_meter), 0);
        const totalRupiah = totalTerkumpul * 800000;
        
        res.json({
            terkumpul_meter: totalTerkumpul,
            terkumpul_rupiah: totalRupiah,
            target_meter: 2805,
            target_rupiah: 2805 * 800000
        });
    } catch (error) {
        console.error("Progress error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// 3. WEBHOOK MIDTRANS (Auto-Update Progress Segmen 1)
// ==========================================
app.post('/api/webhook', async (req, res) => {
    try {
        const data = req.body;
        
        // Jika donatur berhasil bayar via Midtrans
        if (data.transaction_status === 'settlement' || data.transaction_status === 'capture') {
            const luasMeter = parseFloat(data.gross_amount) / 800000;
            
            // Simpan ke Supabase agar Progress Bar bergerak
            const { error } = await supabase
                .from('transaksi')
                .upsert({
                    order_id: data.order_id,
                    luas_meter: luasMeter,
                    status: 'LUNAS'
                });

            if (error) console.error('Error simpan ke Supabase:', error);
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error("Webhook error:", error);
        res.status(500).send('Error');
    }
});

// ==========================================
// 4. API UPLOAD BUKTI TRANSFER (Segmen 2)
// ==========================================
app.post('/api/submit-tax-donation', async (req, res) => {
    try {
        const { fileName, fileType, fileBase64 } = req.body;
        let publicFileUrl = 'Gagal memuat link bukti transfer';

        if (fileBase64) {
            const base64Data = fileBase64.replace(/^data:.*;base64,/, '');
            const fileBuffer = Buffer.from(base64Data, 'base64');
            const uniqueFileName = `bukti_${Date.now()}_${fileName.replace(/\s+/g, '_')}`;

            // Upload ke Supabase Storage (Bucket: bukti-transfer)
            const { error: uploadError } = await supabase.storage
                .from('bukti-transfer')
                .upload(uniqueFileName, fileBuffer, { 
                    contentType: fileType, 
                    upsert: true 
                });

            if (!uploadError) {
                // Ambil link publik gambar yang baru diupload
                const { data: urlData } = supabase.storage
                    .from('bukti-transfer')
                    .getPublicUrl(uniqueFileName);
                publicFileUrl = urlData.publicUrl;
            } else {
                console.error('Upload Error:', uploadError.message);
            }
        }
        
        // Kembalikan URL gambar ke frontend untuk dirangkai ke pesan WhatsApp
        res.status(200).json({ success: true, fileUrl: publicFileUrl });
    } catch (error) {
        console.error('Server Upload Error:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;

// Hindari bentrok port di Vercel/Hosting
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server Backend berjalan di port ${PORT}`);
    });
}

module.exports = app;