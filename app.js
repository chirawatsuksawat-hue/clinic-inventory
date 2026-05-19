function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.querySelector('.sidebar-overlay').classList.toggle('open');
}

let allItems = []; 
let historyData = []; 
let auditData = []; 
let currentMode = 'out';

// ประกาศตัวแปรรองรับกล้อง
let html5QrCode = null; 
let auditHtml5QrCode = null;
let manualHtml5QrCode = null; 
let popupScanner = null; // ตัวนี้ใช้สำหรับหน้าเพิ่ม/แก้ไขพัสดุ

let db = null;
let currentCalcIndex = -1;
let currentCalcField = '';
let currentCalcTargetId = '';

function getCategoryOptionsHTML() {
    // ล็อกหมวดหมู่พื้นฐาน
    let cats = new Set(["เวชภัณฑ์ทางการแพทย์", "อุปกรณ์สำนักงาน", "น้ำยา/อุปกรณ์ทำความสะอาด", "น้ำยาไต (ทั่วไป)", "อื่นๆ"]);
    
    // ดึงหมวดหมู่อื่นๆ จากฐานข้อมูลมาแสดงทั้งหมดอย่างครบถ้วน
    allItems.forEach(item => { 
        if(item && item.category && item.category.length < 40) {
            cats.add(item.category);
        }
    });
    
    let html = '';
    cats.forEach(cat => {
        html += `<option value="${cat}">`;
    });
    return html;
}

function initApp() {
    try {
        const firebaseConfig = {
            apiKey: "AIzaSyDrOh48Beqc_kIZPQyxM1pe4BPphZwKYEg", 
            databaseURL: "https://dialysis-inventory-fab4e-default-rtdb.asia-southeast1.firebasedatabase.app/",
            projectId: "dialysis-inventory-fab4e"
        };
        firebase.initializeApp(firebaseConfig);
        db = firebase.database();
        db.ref('.info/connected').on('value', function(connectedSnap) {
            if (connectedSnap.val() === true) {
                setSyncStatus("ออนไลน์ (Firebase)", "success", "wifi");
                loadOnlineData();
            } else {
                setSyncStatus("ออฟไลน์ (Local File)", "info", "database");
                loadLocalData();
            }
        });
    } catch (e) {
        setSyncStatus("ออฟไลน์ (Local File)", "info", "database");
        loadLocalData();
    }
}

function setSyncStatus(text, color, icon) {
    document.getElementById('syncStatus').className = `badge bg-${color} px-3 py-2 me-2`;
    document.getElementById('syncStatus').innerHTML = `<i class="fas fa-${icon} me-1"></i> ${text}`;
}

function loadOnlineData() {
    if(!db) return;
    db.ref('inventory_data').on('value', (snap) => {
        let data = snap.val() || [];
        allItems = Array.isArray(data) ? data : Object.keys(data).map(k => data[k]);
        updateTableUI();
    });
    
    // 🌟 แก้ไขจุดนี้: ดึงข้อมูลประวัติและแปลงให้เป็น Array เสมอ
    db.ref('history_data').on('value', (snap) => {
        let hData = snap.val() || [];
        // บังคับแปลงเป็น Array และกรองค่าแหว่ง (null) ทิ้ง
        historyData = (Array.isArray(hData) ? hData : Object.keys(hData).map(k => hData[k])).filter(item => item !== null);
        
        if(document.getElementById('auditView').style.display === 'block') renderAuditList();
        if(document.getElementById('historyView').style.display === 'block') renderHistoryList(); 
    });
}

function loadLocalData() {
    fetch('inventory_db.json?t=' + new Date().getTime())
        .then(r => r.json()).then(data => { allItems = data; updateTableUI(); }).catch(e => console.error(e));
        
    fetch('inventory_history.json?t=' + new Date().getTime())
        .then(r => r.json()).then(data => { 
            historyData = (Array.isArray(data) ? data : Object.keys(data).map(k => data[k])).filter(item => item !== null);
            if(document.getElementById('historyView').style.display === 'block') renderHistoryList(); 
        }).catch(e => console.error(e));
}

function forceReload() {
    if(db && document.getElementById('syncStatus').innerText.includes('ออนไลน์')) loadOnlineData();
    else loadLocalData();
}

function getUsed30d(itemName) {
    if (!itemName || !historyData) return 0;
    let total = 0; let now = new Date();
    historyData.forEach(h => {
        if (h && h.action && h.action.includes("ใช้งานจริง") && h.name === itemName) {
            let parts = h.date.split(" ")[0].split("/");
            if (parts.length === 3) {
                let d = new Date(parts[2], parts[1]-1, parts[0]);
                let diffDays = (now - d) / (1000 * 60 * 60 * 24);
                if (diffDays <= 30) total += parseInt(h.qty) || 0;
            }
        }
    });
    return total;
}

document.addEventListener("DOMContentLoaded", initApp);
setInterval(() => { if (!db || document.getElementById('syncStatus').innerText.includes('ออฟไลน์')) loadLocalData(); }, 3000);

function updateTableUI() {
    const tbody = document.getElementById('inventory-table-body');
    tbody.innerHTML = ''; 
    if (!allItems || allItems.length === 0) return tbody.innerHTML = '<tr><td colspan="7" class="text-center py-5">ไม่มีข้อมูลพัสดุ</td></tr>';

    let validItems = allItems.filter(item => item && item.name);
    validItems.sort((a, b) => (parseFloat(a.seq_num) || 99999) - (parseFloat(b.seq_num) || 99999));

    validItems.forEach(item => {
        let main_s = parseInt(item.main_stock || 0);
        let sub_s = parseInt(item.sub_stock || 0);
        let total_s = main_s + sub_s; 
        let unit = item.unit || 'ชิ้น';
        let originalIndex = allItems.indexOf(item);
        let mainColor = main_s > 10 ? 'text-success' : (main_s > 0 ? 'text-warning' : 'text-danger');
            
        let row = `<tr>
            <td class="text-center fw-bold text-secondary">${item.seq_num || '-'}</td>
            <td class="text-secondary">${item.code || '-'}</td>
            <td class="fw-bold text-dark" style="white-space: normal; min-width: 150px;">${item.name || '-'}<br><small class="text-muted fw-normal">${item.category || '-'}</small></td>
            <td class="text-center fs-6"><b class="${mainColor} fs-5">${main_s}</b> <small class="text-muted">${unit}</small></td>
            <td class="text-center fs-6"><b class="text-danger fs-5">${sub_s}</b> <small class="text-muted">${unit}</small></td>
            <td class="text-center fs-5 text-primary fw-bold">${total_s}</td>
            <td class="text-center"><button class="btn btn-outline-primary btn-sm" onclick="editItem(${originalIndex})"><i class="fas fa-edit"></i></button></td>
        </tr>`;
        tbody.insertAdjacentHTML('beforeend', row);
    });
    renderDialysisFluids();
}

function renderDialysisFluids() {
    const container = document.getElementById('dialysisFluidContainer');
    if(!container) return;

    // 🌟 ดึงมาแสดงเฉพาะรายการที่ "ชื่อ" หรือ "หมวดหมู่" มีคำว่าน้ำยาไต/น้ำเกลือจริงๆ เท่านั้น
    let fluidKeywords = ["k2", "k3", "k4", "hemo", "nss", "น้ำยาไต", "part a", "part b", "saline"];
    
    let fluids = allItems.map((item, index) => ({item, index})).filter(x => {
        if (!x.item || !x.item.name) return false;
        let nameLower = x.item.name.toLowerCase();
        let catLower = (x.item.category || "").toLowerCase();
        
        return fluidKeywords.some(kw => nameLower.includes(kw) || catLower.includes(kw));
    });

    if (fluids.length === 0) {
        container.innerHTML = '<div class="col-12 text-center text-muted py-2">ยังไม่มีรายการน้ำยาไต หรือ น้ำเกลือ ในคลังพัสดุ</div>';
        return;
    }

    container.innerHTML = '';
    fluids.forEach(f => {
        let item = f.item; let idx = f.index;
        let main_s = parseInt(item.main_stock || 0);
        let sub_s = parseInt(item.sub_stock || 0);
        let total_s = main_s + sub_s;
        let mainColor = main_s > 10 ? 'text-success' : (main_s > 0 ? 'text-warning' : 'text-danger');

        let card = `
        <div class="col-12 col-sm-6 col-md-4 col-lg-3 mb-2">
            <div class="border border-info rounded p-2 text-center shadow-sm bg-light h-100 d-flex flex-column justify-content-between">
                <h6 class="fw-bold text-primary mb-2" style="font-size: 0.95rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${item.name}</h6>
                <div>
                    <div class="bg-white rounded border py-1 mb-2" style="font-size: 0.85rem;">
                        <div class="d-flex justify-content-around mb-1 border-bottom pb-1">
                            <span class="text-dark">คลัง: <b class="${mainColor} fs-6">${main_s}</b></span>
                            <span class="text-dark">ย่อย: <b class="text-danger fs-6">${sub_s}</b></span>
                        </div>
                        <div class="fw-bold text-primary">ยอดรวม: <span class="fs-5">${total_s}</span></div>
                    </div>
                    <div class="d-flex gap-1 mt-auto">
                        <button class="btn btn-warning btn-sm flex-fill fw-bold shadow-sm" onclick="showStockDialog(${idx}, 'use')"><i class="fas fa-minus-circle"></i> เบิก</button>
                        <button class="btn btn-secondary btn-sm flex-fill fw-bold text-white shadow-sm" onclick="showStockDialog(${idx}, 'audit')"><i class="fas fa-clipboard-check"></i> นับ</button>
                    </div>
                </div>
            </div>
        </div>`;
        container.insertAdjacentHTML('beforeend', card);
    });
}

function stopAllScanners() {
    if (html5QrCode) { html5QrCode.stop().then(() => { html5QrCode.clear(); html5QrCode = null; document.getElementById('reader').style.display = 'none'; }).catch(()=>{}); }
    if (auditHtml5QrCode) { auditHtml5QrCode.stop().then(() => { auditHtml5QrCode.clear(); auditHtml5QrCode = null; document.getElementById('auditReader').style.display = 'none'; }).catch(()=>{}); }
    if (manualHtml5QrCode) { manualHtml5QrCode.stop().then(() => { manualHtml5QrCode.clear(); manualHtml5QrCode = null; document.getElementById('manualReader').style.display = 'none'; }).catch(()=>{}); }
}

function closeAllViews() {
    stopAllScanners();
    document.getElementById('dashboardView').style.display = 'none';
    document.getElementById('manualView').style.display = 'none';
    document.getElementById('auditView').style.display = 'none';
    document.getElementById('historyView').style.display = 'none';
    document.getElementById('visitView').style.display = 'none';
}

function openManualView() {
    closeAllViews();
    document.getElementById('manualView').style.display = 'block';
    if(window.innerWidth <= 768) toggleSidebar();
}

function openAuditView() {
    closeAllViews();
    document.getElementById('auditView').style.display = 'block';
    if(window.innerWidth <= 768) toggleSidebar();
    auditData = JSON.parse(JSON.stringify(allItems)); 
    document.getElementById('auditSearch').value = '';
    renderAuditList();
}

// 🌟 ฟังก์ชันเปิดหน้าประวัติ 🌟
function openHistoryView() {
    closeAllViews();
    document.getElementById('historyView').style.display = 'block';
    if(window.innerWidth <= 768) toggleSidebar();
    document.getElementById('historySearch').value = '';
    renderHistoryList();
}

// ==========================================
// 🚀 ระบบสแกนแบบ Manual
// ==========================================
function toggleManualScan() {
    const rDiv = document.getElementById('manualReader');
    if (manualHtml5QrCode) { manualHtml5QrCode.stop().then(() => { manualHtml5QrCode.clear(); manualHtml5QrCode = null; rDiv.style.display = 'none'; }); return; }
    rDiv.style.display = 'block'; manualHtml5QrCode = new Html5Qrcode("manualReader");
    manualHtml5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onManualScanSuccess, ()=>{})
        .catch(() => { manualHtml5QrCode.start({ facingMode: "user" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onManualScanSuccess, ()=>{})
        .catch(() => { Swal.fire("ข้อผิดพลาด", "ไม่สามารถเปิดกล้องได้", "error"); rDiv.style.display = 'none'; manualHtml5QrCode = null; }); });
}

function onManualScanSuccess(t) { 
    try{document.getElementById('soundScan').play()}catch(e){} 
    if(manualHtml5QrCode) { manualHtml5QrCode.stop().then(() => { manualHtml5QrCode.clear(); manualHtml5QrCode = null; document.getElementById('manualReader').style.display = 'none'; }); } 
    handleManualScan(t); 
}

function handleManualScan(code) {
    code = code.trim(); if(!code) return;
    document.getElementById('manualCodeInput').value = ''; // เคลียร์ช่องพิมพ์
    const idx = allItems.findIndex(i => i && i.code === code);
    
    if (idx > -1) {
        const item = allItems[idx];
        Swal.fire({
            title: '📌 เลือกลักษณะรายการที่ต้องการทำ',
            html: `
                <h5 class="text-primary fw-bold mt-2">${item.name}</h5>
                <div class="p-2 bg-light mb-3 mt-2 rounded text-center" style="font-size: 1.1rem;">
                    คลังหลัก: <b class="text-dark">${item.main_stock || 0}</b> | คลังย่อย: <b class="text-danger">${item.sub_stock || 0}</b>
                </div>
                <div class="d-grid gap-2">
                    <button class="btn btn-success fw-bold py-2 shadow-sm" onclick="Swal.close(); setTimeout(()=>showStockDialog(${idx}, 'receive_main'), 300)"><i class="fas fa-download me-1"></i> รับของเข้าคลัง</button>
                    <button class="btn btn-primary fw-bold py-2 shadow-sm" onclick="Swal.close(); setTimeout(()=>showStockDialog(${idx}, 'transfer'), 300)"><i class="fas fa-exchange-alt me-1"></i> โอนย้ายคลัง</button>
                    <button class="btn btn-warning fw-bold py-2 shadow-sm" onclick="Swal.close(); setTimeout(()=>showStockDialog(${idx}, 'use'), 300)"><i class="fas fa-upload me-1"></i> เบิกจ่าย (หักออก)</button>
                </div>
            `,
            showConfirmButton: false,
            showCancelButton: true,
            cancelButtonText: 'ยกเลิก'
        });
    } else {
        Swal.fire({ title: 'ไม่พบรหัสนี้!', html: `รหัสบาร์โค้ด: <b class="text-danger fs-5">${code}</b><br><br>นำรหัสนี้ไปลงทะเบียนใหม่หรือไม่?`, icon: 'warning', showCancelButton: true, confirmButtonText: '➕ ลงทะเบียนใหม่'
        }).then(res => { if (res.isConfirmed) manualAction('add_item', code); });
    }
}

// ==========================================

let pendingManualMode = '';
function openItemSelector(mode) {
    pendingManualMode = mode;
    let title = "เลือกพัสดุที่ต้องการ";
    if(mode === 'receive_main') title = "รับเข้าคลังหลัก";
    if(mode === 'transfer') title = "โอนย้ายคลัง";
    if(mode === 'use') title = "เบิกจ่าย (ใช้งานจริง)";
    
    document.getElementById('itemSelectorTitle').innerText = title;
    document.getElementById('searchItemSelector').value = '';
    renderItemSelectorList();
    new bootstrap.Modal(document.getElementById('itemSelectorModal')).show();
}

function renderItemSelectorList() {
    let term = document.getElementById('searchItemSelector').value.toLowerCase();
    let container = document.getElementById('itemSelectorList');
    container.innerHTML = '';
    
    let validItems = allItems.map((item, index) => ({ item, index })).filter(x => x.item && x.item.name);
    validItems.forEach(f => {
        if(term && !f.item.name.toLowerCase().includes(term) && !(f.item.code||"").toLowerCase().includes(term)) return;
        
        let btn = document.createElement('button');
        btn.className = "list-group-item list-group-item-action d-flex justify-content-between align-items-center";
        btn.innerHTML = `
            <div>
                <span class="badge bg-secondary me-2">${f.item.code || '-'}</span>
                <span class="fw-bold">${f.item.name}</span>
            </div>
            <span class="badge bg-info rounded-pill">คงเหลือ ${parseInt(f.item.main_stock||0)+parseInt(f.item.sub_stock||0)}</span>
        `;
        btn.onclick = () => {
            bootstrap.Modal.getInstance(document.getElementById('itemSelectorModal')).hide();
            showStockDialog(f.index, pendingManualMode);
        };
        container.appendChild(btn);
    });
}

function showStockDialog(idx, mode) {
    const item = allItems[idx];
    let title = '', btnColor = '', extraHtml = '';
    
    if (mode === 'receive_main') { title = '📥 รับเข้าคลังหลัก'; btnColor = '#2ecc71'; }
    else if (mode === 'use') { title = '📤 เบิกจ่าย (หักคลังย่อย)'; btnColor = '#e67e22'; }
    else if (mode === 'receive_sub') { title = '📥 รับเข้าคลังย่อย'; btnColor = '#3498db'; }
    else if (mode === 'transfer') { 
        title = '🔄 โอนย้ายคลัง'; btnColor = '#3498db'; 
        extraHtml = `<select id="transfer-dir" class="form-select border-primary mt-2" style="height:45px;"><option value="transfer_to_sub">คลังหลัก ➡️ คลังย่อย</option><option value="transfer_to_main">คลังย่อย ➡️ คลังหลัก</option></select>`;
    }
    
    if (mode === 'audit') {
        title = '📋 ปรับยอด (Spot Audit)'; btnColor = '#6c757d'; 
        extraHtml = `
            <div class="row mt-3 text-start" style="font-family: 'Sarabun', sans-serif;">
                <div class="col-6">
                    <label class="form-label fw-bold text-secondary">ยอดจริง (คลังหลัก)</label>
                    <div class="input-group">
                        <input type="number" id="audit-main" class="form-control text-center border-secondary fs-5" value="${item.main_stock || 0}" onclick="this.select()">
                        <button class="btn btn-secondary" onclick="openCalculator(-1, 'audit-main', document.getElementById('audit-main').value)"><i class="fas fa-calculator"></i></button>
                    </div>
                </div>
                <div class="col-6">
                    <label class="form-label fw-bold text-danger">ยอดจริง (คลังย่อย)</label>
                    <div class="input-group">
                        <input type="number" id="audit-sub" class="form-control text-center border-danger text-danger fs-5" value="${item.sub_stock || 0}" onclick="this.select()">
                        <button class="btn btn-danger" onclick="openCalculator(-1, 'audit-sub', document.getElementById('audit-sub').value)"><i class="fas fa-calculator"></i></button>
                    </div>
                </div>
            </div>`;
    } else {
        extraHtml += `
            <div class="mt-3 text-start fw-bold">จำนวนที่ต้องการทำรายการ (${item.unit || 'ชิ้น'}):</div>
            <div class="input-group mt-1">
                <input type="number" id="swal-manual-input" class="form-control text-center fs-4 fw-bold text-primary border-primary" value="1" onclick="this.select()">
                <button class="btn btn-primary px-3" onclick="openCalculator(-1, 'swal-manual-input', document.getElementById('swal-manual-input').value)"><i class="fas fa-calculator"></i></button>
            </div>
        `;
    }

    Swal.fire({
        title: title,
        html: `
            <h5 class="text-primary fw-bold mt-2">${item.name}</h5>
            <div class="p-2 bg-light mb-3 mt-2 rounded text-center" style="font-size: 1.1rem;">
                คลังหลัก: <b class="text-dark">${item.main_stock || 0}</b> | คลังย่อย: <b class="text-danger">${item.sub_stock || 0}</b>
            </div>
            ${extraHtml}
        `,
        showCancelButton: true, confirmButtonText: '<i class="fas fa-check-circle"></i> ยืนยัน', confirmButtonColor: btnColor, cancelButtonText: 'ยกเลิก',
        preConfirm: () => {
            if (mode === 'audit') {
                let m = parseInt(document.getElementById('audit-main').value);
                let s = parseInt(document.getElementById('audit-sub').value);
                if (isNaN(m) || isNaN(s) || m < 0 || s < 0) return Swal.showValidationMessage('ระบุตัวเลขที่ถูกต้อง');
                return { action: 'audit', new_main: m, new_sub: s };
            } else {
                let q = parseInt(document.getElementById('swal-manual-input').value);
                if (!q || q <= 0) return Swal.showValidationMessage('ใส่จำนวนมากกว่า 0');
                if (mode === 'use' && q > parseInt(item.sub_stock)) return Swal.showValidationMessage('คลังย่อยมีไม่พอ!');
                if (mode === 'transfer') {
                    let dir = document.getElementById('transfer-dir').value;
                    if(dir === 'transfer_to_sub' && q > parseInt(item.main_stock)) return Swal.showValidationMessage('คลังหลักไม่พอโอน');
                    if(dir === 'transfer_to_main' && q > parseInt(item.sub_stock)) return Swal.showValidationMessage('คลังย่อยไม่พอโอน');
                    return { qty: q, action: dir };
                }
                return { qty: q, action: mode };
            }
        }
    }).then(res => { 
        if (res.isConfirmed) {
            if (res.value.action === 'audit') {
                if (db && document.getElementById('syncStatus').innerText.includes('ออนไลน์')) {
                    db.ref(`inventory_data/${idx}`).update({ main_stock: res.value.new_main, sub_stock: res.value.new_sub }).then(() => {
                        const currentParams = new URLSearchParams(window.location.search);
                        const savedUserName = currentParams.get('user') || "มือถือ-ไม่ระบุชื่อ";
                        
                        // 🌟 สร้าง ID เฉพาะสำหรับ History
                        let historyId = "HIST-" + new Date().getTime();
                        let log = { id: historyId, date: new Date().toLocaleDateString('en-GB')+" "+new Date().toLocaleTimeString('en-GB'), code: item.code, name: item.name, action: "ปรับยอด (Spot Audit)", qty: 0, unit: item.unit, main_bal: res.value.new_main, sub_bal: res.value.new_sub, user: savedUserName };
                        db.ref('history_data').once('value').then(s => { let arr = s.val() || []; arr.unshift(log); db.ref('history_data').set(arr); });
                        Swal.fire({title:'สำเร็จ!', icon:'success', timer:1500, showConfirmButton: false});
                    });
                }
            } else {
                processStockUpdate(item, idx, res.value.qty, res.value.action); 
            }
        }
    });
}

function processStockUpdate(item, idx, qty, action) {
    let n_main = parseInt(item.main_stock || 0), n_sub = parseInt(item.sub_stock || 0), actText = "";
    if (action === 'receive_main') { n_main += qty; actText = "รับเข้าคลังหลัก 📥"; }
    else if (action === 'receive_sub') { n_sub += qty; actText = "รับเข้าคลังย่อย 📥"; }
    else if (action === 'use') { n_sub -= qty; actText = "ใช้งานจริง 📤"; }
    else if (action === 'transfer_to_sub') { n_main -= qty; n_sub += qty; actText = "โอนไปคลังย่อย 🔄"; }
    else if (action === 'transfer_to_main') { n_sub -= qty; n_main += qty; actText = "คืนเข้าคลังหลัก 🔄"; }

    if (db && document.getElementById('syncStatus').innerText.includes('ออนไลน์')) {
        db.ref(`inventory_data/${idx}`).update({ main_stock: n_main, sub_stock: n_sub }).then(() => {
            const currentParams = new URLSearchParams(window.location.search);
            const savedUserName = currentParams.get('user') || "มือถือ-ไม่ระบุชื่อ";

            // 🌟 จุดสำคัญ: ต้องเก็บ id และ raw_action เพื่อให้ระบบรู้ว่าต้องย้อนกลับยังไง
            let historyId = "HIST-" + new Date().getTime();
            let log = { id: historyId, date: new Date().toLocaleDateString('en-GB')+" "+new Date().toLocaleTimeString('en-GB'), code: item.code, name: item.name, action: actText, qty: qty, unit: item.unit, main_bal: n_main, sub_bal: n_sub, user: savedUserName, raw_action: action }; 
            
            db.ref('history_data').once('value').then(s => { let arr = s.val() || []; arr.unshift(log); db.ref('history_data').set(arr); });
            Swal.fire({title:'สำเร็จ!', icon:'success', timer:1500, showConfirmButton: false});
        });
    } else if (typeof pywebview !== 'undefined' && pywebview.api) {
        pywebview.api.update_stock_from_web(item.code, qty, action).then(r => { if(r.success) { Swal.fire({title:'สำเร็จ!', icon:'success', timer:1500}); forceReload(); } else Swal.fire('Error', r.message, 'error'); });
    } 
}

function manualAction(mode, scannedCode = "") {
    if (mode === 'add_item') {
        Swal.fire({
            title: '➕ เพิ่มทะเบียนพัสดุใหม่', width: '600px',
            html: `
                <div class="text-start mt-3" style="font-family: 'Sarabun', sans-serif;">
                    <div class="row">
                        <div class="col-md-4 mb-3"><label class="form-label fw-bold">ลำดับ</label><input id="swal-seq" class="form-control" placeholder="1, 2, ..."></div>
                        <div class="col-md-8 mb-3">
                            <label class="form-label fw-bold text-primary">หมวดหมู่</label>
                            <input type="text" id="swal-cat" list="catList" class="form-control border-primary" style="height: 45px;" placeholder="พิมพ์หมวดหมู่ใหม่ หรือเลือกจากรายการ...">
                            <datalist id="catList">${getCategoryOptionsHTML()}</datalist>
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <label class="form-label fw-bold">รหัสพัสดุ (Code)</label>
                            <div class="input-group">
                                <input id="swal-code" class="form-control" placeholder="เช่น A01" value="${scannedCode}">
                                <button type="button" class="btn btn-warning text-dark fw-bold px-3" onclick="generateRandomCodePopup('swal-code')" title="สุ่มรหัส"><i class="fas fa-dice"></i></button>
                                <button type="button" class="btn btn-info text-white fw-bold px-3" onclick="startScannerPopup('readerPopup', 'swal-code')" title="เปิดกล้องสแกน"><i class="fas fa-camera"></i></button>
                            </div>
                            <div id="readerPopup" style="display: none; width: 100%; margin-top: 8px; border-radius: 8px; overflow: hidden; border: 2px solid #17a2b8;"></div>
                        </div>
                        <div class="col-md-6 mb-3"><label class="form-label fw-bold">ชื่อพัสดุ / อุปกรณ์</label><input id="swal-name" class="form-control" placeholder="ระบุชื่อพัสดุ"></div>
                    </div>
                    <div class="row">
                        <div class="col-md-4 mb-3"><label class="form-label fw-bold">หน่วยนับ</label><input id="swal-unit" class="form-control" placeholder="เช่น ชิ้น, กล่อง"></div>
                        <div class="col-md-4 mb-3"><label class="form-label fw-bold">บรรจุ/กล่อง</label><input type="number" id="swal-per-box" class="form-control" value="1"></div>
                        <div class="col-md-4 mb-3"><label class="form-label fw-bold">ราคา/หน่วย (บาท)</label><input type="number" id="swal-price" class="form-control" value="0"></div>
                    </div>
                    <hr>
                    <div class="row bg-light p-2 rounded mx-0">
                        <div class="col-md-4 mb-2 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.9rem;">ใช้เฉลี่ย/เดือน</label><input type="number" id="swal-usage" class="form-control text-center" value="0"></div>
                        <div class="col-md-4 mb-2 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.9rem;">ยอดตั้งต้น</label><input type="number" id="swal-target" class="form-control text-center" value="0"></div>
                        <div class="col-md-4 mb-2 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.9rem;">แจ้งเตือนใกล้หมด</label><input type="number" id="swal-min" class="form-control text-center" value="10"></div>
                    </div>
                </div>
            `,
            showCancelButton: true, confirmButtonText: '<i class="fas fa-save"></i> บันทึกข้อมูล', confirmButtonColor: '#2ecc71', cancelButtonText: 'ยกเลิก',
            preConfirm: () => { 
                return { 
                    seq_num: document.getElementById('swal-seq').value.trim(), 
                    code: document.getElementById('swal-code').value.trim(), 
                    name: document.getElementById('swal-name').value.trim(), 
                    category: document.getElementById('swal-cat').value, 
                    unit: document.getElementById('swal-unit').value.trim() || 'ชิ้น', 
                    qty_per_box: document.getElementById('swal-per-box').value || "1", 
                    price: parseFloat(document.getElementById('swal-price').value) || 0, 
                    monthly_usage: parseFloat(document.getElementById('swal-usage').value) || 0, 
                    target_stock: parseInt(document.getElementById('swal-target').value) || 0, 
                    min_alert: parseInt(document.getElementById('swal-min').value) || 10 
                } 
            }
        }).then(res => {
            if (res.isConfirmed) {
                if(!res.value.name || !res.value.code) return Swal.fire('ผิดพลาด', 'กรุณากรอกข้อมูลให้ครบ', 'warning');
                if (allItems.some(i => i && i.code === res.value.code)) return Swal.fire('ผิดพลาด', 'รหัสนี้มีในระบบแล้ว!', 'error');
                
                let newItem = { 
                    id: "ITM" + String(allItems.length + 1).padStart(4, '0'), 
                    seq_num: res.value.seq_num, 
                    code: res.value.code, 
                    name: res.value.name, 
                    category: res.value.category, 
                    unit: res.value.unit, 
                    qty_per_box: res.value.qty_per_box, 
                    price: res.value.price, 
                    monthly_usage: res.value.monthly_usage, 
                    target_stock: res.value.target_stock, 
                    min_alert: res.value.min_alert, 
                    main_stock: 0, 
                    sub_stock: 0, 
                    req_qty: "", 
                    req_note: "" 
                };

                if (db && document.getElementById('syncStatus').innerText.includes('ออนไลน์')) { 
                    db.ref('inventory_data').once('value').then(snap => {
                        let data = snap.val() || [];
                        let nextIdx = Array.isArray(data) ? data.length : Math.max(...Object.keys(data).map(Number)) + 1;
                        if(nextIdx < 0 || !isFinite(nextIdx)) nextIdx = 0;
                        
                        db.ref(`inventory_data/${nextIdx}`).set(newItem).then(() => {
                            Swal.fire('สำเร็จ', 'บันทึกพัสดุใหม่ขึ้นระบบออนไลน์แล้ว', 'success');
                            forceReload(); 
                        });
                    });
                } 
                else if (typeof pywebview !== 'undefined' && pywebview.api) { 
                    pywebview.api.add_item_from_web(newItem).then(r => forceReload()); 
                    Swal.fire('สำเร็จ', 'บันทึกในเครื่องแล้ว', 'success'); 
                }
            }
        });
    }
}

function editItem(idx) {
    const item = allItems[idx]; 
    Swal.fire({
        title: '📝 แก้ไขข้อมูลพัสดุ', width: '600px',
        html: `
            <div class="text-start mt-3" style="font-family: 'Sarabun', sans-serif;">
                <div class="row">
                    <div class="col-md-4 mb-3"><label class="form-label fw-bold">ลำดับ</label><input id="edit-seq" class="form-control" value="${item.seq_num || ''}"></div>
                    <div class="col-md-8 mb-3">
                        <label class="form-label fw-bold text-primary">หมวดหมู่</label>
                        <input type="text" id="edit-cat" list="catListEdit" class="form-control border-primary" style="height: 45px;" value="${item.category || ''}" placeholder="พิมพ์หมวดหมู่ใหม่ หรือเลือกจากรายการ...">
                        <datalist id="catListEdit">${getCategoryOptionsHTML()}</datalist>
                    </div>
                </div>
                <div class="row">
                    <div class="col-md-6 mb-3">
                        <label class="form-label fw-bold">รหัสพัสดุ (Code)</label>
                        <div class="input-group">
                            <input id="edit-code" class="form-control" value="${item.code || ''}">
                            <button type="button" class="btn btn-warning text-dark fw-bold px-3" onclick="generateRandomCodePopup('edit-code')" title="สุ่มรหัส"><i class="fas fa-dice"></i></button>
                            <button type="button" class="btn btn-info text-white fw-bold px-3" onclick="startScannerPopup('readerPopupEdit', 'edit-code')" title="เปิดกล้องสแกน"><i class="fas fa-camera"></i></button>
                        </div>
                        <div id="readerPopupEdit" style="display: none; width: 100%; margin-top: 8px; border-radius: 8px; overflow: hidden; border: 2px solid #17a2b8;"></div>
                    </div>
                    <div class="col-md-6 mb-3"><label class="form-label fw-bold">ชื่อพัสดุ / อุปกรณ์</label><input id="edit-name" class="form-control" value="${item.name || ''}"></div>
                </div>
                <div class="row">
                    <div class="col-md-4 mb-3"><label class="form-label fw-bold">หน่วยนับ</label><input id="edit-unit" class="form-control" value="${item.unit || 'ชิ้น'}"></div>
                    <div class="col-md-4 mb-3"><label class="form-label fw-bold">บรรจุ/กล่อง</label><input type="number" id="edit-per-box" class="form-control" value="${item.qty_per_box || ''}"></div>
                    <div class="col-md-4 mb-3"><label class="form-label fw-bold">ราคา/หน่วย (บาท)</label><input type="number" id="edit-price" class="form-control" value="${item.price || ''}"></div>
                </div>
                <hr>
                <div class="row bg-light p-2 rounded mx-0">
                    <div class="col-md-4 mb-2 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.9rem;">ใช้เฉลี่ย/เดือน</label><input type="number" id="edit-usage" class="form-control text-center" value="${item.monthly_usage || ''}"></div>
                    <div class="col-md-4 mb-2 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.9rem;">ยอดตั้งต้น</label><input type="number" id="edit-target" class="form-control text-center" value="${item.target_stock || ''}"></div>
                    <div class="col-md-4 mb-2 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.9rem;">แจ้งเตือนใกล้หมด</label><input type="number" id="edit-min" class="form-control text-center" value="${item.min_alert || ''}"></div>
                </div>
            </div>
        `,
        showCancelButton: true, confirmButtonText: '<i class="fas fa-save"></i> บันทึกการแก้ไข', confirmButtonColor: '#3498db', cancelButtonText: 'ยกเลิก',
        preConfirm: () => { return { seq_num: document.getElementById('edit-seq').value.trim(), code: document.getElementById('edit-code').value.trim(), name: document.getElementById('edit-name').value.trim(), category: document.getElementById('edit-cat').value, unit: document.getElementById('edit-unit').value.trim() || 'ชิ้น', qty_per_box: document.getElementById('edit-per-box').value || "1", price: parseFloat(document.getElementById('edit-price').value) || 0, monthly_usage: parseFloat(document.getElementById('edit-usage').value) || 0, target_stock: parseInt(document.getElementById('edit-target').value) || 0, min_alert: parseInt(document.getElementById('edit-min').value) || 10 } }
    }).then((res) => {
        if (res.isConfirmed) {
            if(!res.value.name || !res.value.code) return Swal.fire('ผิดพลาด', 'กรุณากรอกชื่อและรหัสให้ครบ', 'warning');
            if (db && document.getElementById('syncStatus').innerText.includes('ออนไลน์')) { db.ref(`inventory_data/${idx}`).update(res.value).then(() => Swal.fire('สำเร็จ!', 'แก้ไขข้อมูลเรียบร้อยแล้ว', 'success')); } 
            else if (typeof pywebview !== 'undefined' && pywebview.api && pywebview.api.edit_item_from_web) { pywebview.api.edit_item_from_web(idx, res.value).then(r => forceReload()); Swal.fire('สำเร็จ!', 'แก้ไขข้อมูลในเครื่องแล้ว', 'success'); }
        }
    });
}

function openCalculator(idx, targetId, currentValue) {
    currentCalcIndex = idx; currentCalcTargetId = targetId;
    document.getElementById('calcDisplay').value = currentValue || '';
    new bootstrap.Modal(document.getElementById('calculatorModal')).show();
}

function calcAppend(val) { 
    const display = document.getElementById('calcDisplay');
    display.value += val; 
    display.scrollLeft = display.scrollWidth;
}

function calcBackspace() {
    let display = document.getElementById('calcDisplay');
    display.value = display.value.slice(0, -1);
    display.scrollLeft = display.scrollWidth;
}
function calcClear() { document.getElementById('calcDisplay').value = ''; }
function calcCalculate() {
    let expr = document.getElementById('calcDisplay').value;
    if(/^[0-9+\-*/.\s]+$/.test(expr)) { try { let res = eval(expr); if(isFinite(res)) document.getElementById('calcDisplay').value = Math.floor(res); } catch(e) { } } 
    else { Swal.fire('ข้อผิดพลาด', 'รูปแบบการคำนวณไม่ถูกต้อง', 'error'); }
}

function calcConfirm() {
    calcCalculate(); 
    let finalVal = document.getElementById('calcDisplay').value;
    let valInt = parseInt(finalVal || '0');
    if(isNaN(valInt) || valInt < 0) valInt = 0;

    let el = document.getElementById(currentCalcTargetId);
    if(el) {
        el.value = valInt;
        if(currentCalcIndex >= 0 && currentCalcTargetId.includes('audit-')) {
            let field = currentCalcTargetId.includes('main') ? 'main_stock' : 'sub_stock';
            updateAuditVal(currentCalcIndex, field, valInt);
        }
    }
    bootstrap.Modal.getInstance(document.getElementById('calculatorModal')).hide();
}

function renderAuditList() {
    const term = document.getElementById('auditSearch').value.toLowerCase();
    const tbody = document.getElementById('auditListContainerTable');
    tbody.innerHTML = '';
    let validItems = auditData.map((item, index) => ({ item, index })).filter(x => x.item && x.item.name);
    validItems.sort((a, b) => (parseFloat(a.item.seq_num) || 99999) - (parseFloat(b.item.seq_num) || 99999));

    validItems.forEach(({ item, index }) => {
        if (term && !item.name.toLowerCase().includes(term) && !(item.code||"").toLowerCase().includes(term) && !(item.seq_num||"").toLowerCase().includes(term)) return;
        let m_stock = parseInt(item.main_stock || 0); let s_stock = parseInt(item.sub_stock || 0); let total_stock = m_stock + s_stock;
        let sys_total = parseInt(allItems[index].main_stock || 0) + parseInt(allItems[index].sub_stock || 0);
        let row = `
        <tr>
            <td class="text-center fw-bold text-secondary">${item.seq_num || ''}</td>
            <td class="text-center text-secondary">${item.code || '-'}</td>
            <td class="fw-bold" style="white-space: normal; min-width: 200px;">${item.name}</td>
            <td class="text-center"><span class="badge bg-light text-dark border">${item.category || '-'}</span></td>
            <td class="text-center text-warning fw-bold">${getUsed30d(item.name)}</td>
            <td class="text-center text-info fw-bold">${sys_total}</td>
            <td class="text-center px-1">
                <div class="input-group input-group-sm">
                    <input type="number" id="audit-main-${index}" class="form-control text-center audit-input border-secondary p-1" value="${m_stock}" onchange="updateAuditVal(${index}, 'main_stock', this.value)" onkeyup="updateAuditVal(${index}, 'main_stock', this.value)" onclick="this.select()">
                    <button class="btn btn-secondary px-2" type="button" onclick="openCalculator(${index}, 'audit-main-${index}', document.getElementById('audit-main-${index}').value)"><i class="fas fa-calculator"></i></button>
                </div>
            </td>
            <td class="text-center px-1">
                <div class="input-group input-group-sm">
                    <input type="number" id="audit-sub-${index}" class="form-control text-center audit-input border-danger text-danger p-1" value="${s_stock}" onchange="updateAuditVal(${index}, 'sub_stock', this.value)" onkeyup="updateAuditVal(${index}, 'sub_stock', this.value)" onclick="this.select()">
                    <button class="btn btn-danger px-2" type="button" onclick="openCalculator(${index}, 'audit-sub-${index}', document.getElementById('audit-sub-${index}').value)"><i class="fas fa-calculator"></i></button>
                </div>
            </td>
            <td class="text-center text-primary fw-bold fs-5" id="audit-total-${index}">${total_stock}</td>
        </tr>`;
        tbody.insertAdjacentHTML('beforeend', row);
    });
}

function updateAuditVal(idx, field, value) {
    let val = parseInt(value); if(isNaN(val) || val < 0) val = 0;
    auditData[idx][field] = val;
    let totalEl = document.getElementById(`audit-total-${idx}`);
    if (totalEl) totalEl.innerText = (parseInt(auditData[idx].main_stock) || 0) + (parseInt(auditData[idx].sub_stock) || 0);
}

function saveBulkAudit() {
    Swal.fire({ title: 'ยืนยันบันทึกยอดตรวจนับ?', text: "ระบบจะอัปเดตสต๊อกของทุกรายการที่ถูกเปลี่ยนแปลง", icon: 'warning', showCancelButton: true, confirmButtonText: 'บันทึกทั้งหมด', confirmButtonColor: '#28a745', cancelButtonText: 'ยกเลิก'
    }).then((res) => {
        if(res.isConfirmed) {
            let updates = {}; let logs = []; let changesCount = 0; let now = new Date().toLocaleDateString('en-GB')+" "+new Date().toLocaleTimeString('en-GB');
            
            const currentParams = new URLSearchParams(window.location.search);
            const savedUserName = currentParams.get('user') || "มือถือ-ไม่ระบุชื่อ";

            auditData.forEach((item, idx) => {
                let orig = allItems[idx]; if(!orig) return;
                let nMain = parseInt(item.main_stock) || 0, nSub = parseInt(item.sub_stock) || 0;
                let oMain = parseInt(orig.main_stock || 0), oSub = parseInt(orig.sub_stock || 0);
                if(nMain !== oMain || nSub !== oSub) {
                    updates[`inventory_data/${idx}/main_stock`] = nMain; updates[`inventory_data/${idx}/sub_stock`] = nSub;
                    let historyId = "HIST-" + new Date().getTime() + "-" + idx; 
                    // 🌟 ระบุว่าเป็น raw_action: 'audit' (กันไม่ให้กดย้อนกลับมั่ว)
                    logs.push({ id: historyId, date: now, code: item.code, name: item.name, action: "ทำใบตรวจนับ (Audit) 📋", qty: 0, unit: item.unit, main_bal: nMain, sub_bal: nSub, user: savedUserName, raw_action: 'audit' }); 
                    changesCount++;
                }
            });
            if(changesCount === 0) return Swal.fire('ไม่มีการเปลี่ยนแปลง', 'ยอดทั้งหมดตรงกับในระบบอยู่แล้วครับ', 'info');
            if(db && document.getElementById('syncStatus').innerText.includes('ออนไลน์')) {
                Swal.fire({title: 'กำลังบันทึก...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});
                db.ref().update(updates).then(() => {
                    if(logs.length > 0) { db.ref('history_data').once('value').then(s => { let arr = s.val() || []; arr = logs.concat(arr); db.ref('history_data').set(arr); }); }
                    Swal.fire('สำเร็จ!', `อัปเดตยอดสต๊อกใหม่จำนวน ${changesCount} รายการเรียบร้อยแล้ว`, 'success');
                    closeAuditView(); 
                });
            } else { Swal.fire('ข้อผิดพลาด', 'ต้องต่ออินเทอร์เน็ตเพื่อบันทึกใบตรวจนับ', 'error'); }
        }
    });
}

function setMode(m) {
    currentMode = m;
    document.getElementById('btnModeOut').className = m === 'out' ? 'btn btn-warning flex-fill fw-bold py-2 shadow-sm active' : 'btn btn-outline-warning flex-fill fw-bold py-2 shadow-sm';
    document.getElementById('btnModeIn').className = m === 'in' ? 'btn btn-success flex-fill fw-bold py-2 shadow-sm active' : 'btn btn-outline-success flex-fill fw-bold py-2 shadow-sm';
    document.getElementById('btnModeAudit').className = m === 'audit' ? 'btn btn-secondary text-white flex-fill fw-bold py-2 shadow-sm active' : 'btn btn-outline-secondary flex-fill fw-bold py-2 shadow-sm';
}

function handleScanResult(code) {
    code = code.trim(); if(!code) return;
    document.getElementById('codeInput').value = '';
    const idx = allItems.findIndex(i => i && i.code === code);
    if (idx > -1) {
        let act = 'receive_sub'; if(currentMode === 'out') act = 'use'; if(currentMode === 'audit') act = 'audit';
        showStockDialog(idx, act);
    } else {
        Swal.fire({ title: 'ไม่พบรหัสนี้!', html: `รหัสบาร์โค้ด: <b class="text-danger fs-5">${code}</b><br><br>นำรหัสนี้ไปลงทะเบียนใหม่หรือไม่?`, icon: 'warning', showCancelButton: true, confirmButtonText: '➕ ลงทะเบียนใหม่'
        }).then(res => { if (res.isConfirmed) manualAction('add_item', code); });
    }
}

function toggleScan() {
    const rDiv = document.getElementById('reader');
    if (html5QrCode) { html5QrCode.stop().then(() => { html5QrCode.clear(); html5QrCode = null; rDiv.style.display = 'none'; }); return; }
    rDiv.style.display = 'block'; html5QrCode = new Html5Qrcode("reader");
    html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, ()=>{})
        .catch(() => { html5QrCode.start({ facingMode: "user" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, ()=>{})
        .catch(() => { Swal.fire("ข้อผิดพลาด", "ไม่สามารถเปิดกล้องได้", "error"); rDiv.style.display = 'none'; html5QrCode = null; }); });
}

function onScanSuccess(t) { try{document.getElementById('soundScan').play()}catch(e){} if(html5QrCode) { html5QrCode.stop().then(() => { html5QrCode.clear(); html5QrCode = null; document.getElementById('reader').style.display = 'none'; }); } document.getElementById('codeInput').value = t; handleScanResult(t); }

function toggleAuditScan() {
    const rDiv = document.getElementById('auditReader');
    if (auditHtml5QrCode) { auditHtml5QrCode.stop().then(() => { auditHtml5QrCode.clear(); auditHtml5QrCode = null; rDiv.style.display = 'none'; }); return; }
    rDiv.style.display = 'block'; auditHtml5QrCode = new Html5Qrcode("auditReader");
    auditHtml5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onAuditScanSuccess, ()=>{})
        .catch(() => { auditHtml5QrCode.start({ facingMode: "user" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onAuditScanSuccess, ()=>{})
        .catch(() => { Swal.fire("ข้อผิดพลาด", "ไม่สามารถเปิดกล้องได้", "error"); rDiv.style.display = 'none'; auditHtml5QrCode = null; }); });
}

function onAuditScanSuccess(t) { try{document.getElementById('soundScan').play()}catch(e){} if(auditHtml5QrCode) { auditHtml5QrCode.stop().then(() => { auditHtml5QrCode.clear(); auditHtml5QrCode = null; document.getElementById('auditReader').style.display = 'none'; }); } document.getElementById('auditSearch').value = t; renderAuditList(); }

// ==========================================
// 🌟 ฟังก์ชันกล้องสแกนรวม (ใช้ได้ทั้งป๊อปอัปเพิ่ม และ แก้ไข)
// ==========================================
function startScannerPopup(readerId, inputId) {
    const readerDiv = document.getElementById(readerId);
    readerDiv.style.display = 'block';

    if (popupScanner) {
        popupScanner.clear();
    }

    popupScanner = new Html5QrcodeScanner(
        readerId,
        { fps: 10, qrbox: { width: 220, height: 220 } },
        false
    );

    popupScanner.render((decodedText) => {
        document.getElementById(inputId).value = decodedText;
        popupScanner.clear();
        readerDiv.style.display = 'none';
        try { document.getElementById('soundScan').play(); } catch(e) {}
    }, (error) => {});
}

function generateRandomCodePopup(inputId) {
    const prefix = "ITM-"; 
    const randomNum = Math.floor(1000 + Math.random() * 9000); 
    const newCode = prefix + randomNum;
    
    const inputField = document.getElementById(inputId);
    inputField.value = newCode;
    inputField.focus(); 
}

// ==========================================
// 🌟 ฟังก์ชันจัดการหน้า History (ประวัติ) 🌟
// ==========================================

function renderHistoryList() {
    const term = document.getElementById('historySearch').value.toLowerCase();
    const tbody = document.getElementById('historyListContainerTable');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    // ตรวจสอบว่า historyData มีข้อมูลหรือไม่
    if (!historyData || !Array.isArray(historyData) || historyData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-5 text-muted">ไม่มีประวัติการทำรายการ</td></tr>';
        return;
    }

    let hasData = false;

    // วนลูปสร้างตาราง
    historyData.forEach((log, index) => {
        try {
            // ป้องกันโค้ดพังถ้าข้อมูลมาไม่ครบ
            if (!log || typeof log !== 'object') return;
            
            // ดึงค่ามาใช้ พร้อมใส่ค่า Default เผื่อเป็น undefined หรือ null
            let logName = log.name || 'ไม่ทราบชื่อพัสดุ';
            let logCode = log.code || '-';
            let logAction = log.action || 'ไม่มีการกระทำ';
            let logUser = log.user || 'ไม่ระบุ';
            let logDate = log.date || '-';
            let logQty = parseInt(log.qty) || 0;
            let logUnit = log.unit || 'ชิ้น';
            let totalBal = (parseInt(log.main_bal) || 0) + (parseInt(log.sub_bal) || 0);

            // ระบบค้นหา
            if (term) {
                let match = logName.toLowerCase().includes(term) || 
                            logCode.toLowerCase().includes(term) || 
                            logAction.toLowerCase().includes(term) || 
                            logUser.toLowerCase().includes(term);
                if (!match) return;
            }

            hasData = true; // มีข้อมูลผ่านการค้นหามาได้

            // กำหนดสีของข้อความ Action
            let actionColor = "text-secondary";
            if (logAction.includes("รับเข้า")) actionColor = "text-success";
            else if (logAction.includes("ใช้งาน") || logAction.includes("เบิกจ่าย")) actionColor = "text-warning";
            else if (logAction.includes("โอนย้าย") || logAction.includes("คืนเข้า")) actionColor = "text-primary";
            else if (logAction.includes("ปรับยอด") || logAction.includes("ตรวจนับ") || logAction.includes("Audit") || log.raw_action === 'audit') actionColor = "text-dark";

            // ปุ่มจัดการ
            let btnHtml = '';
            if (log.raw_action && log.raw_action !== 'audit' && !logAction.includes("Audit")) {
                btnHtml = `<button class="btn btn-outline-danger btn-sm fw-bold shadow-sm" onclick="undoTransaction('${log.id}', ${index})" title="ยกเลิกรายการนี้"><i class="fas fa-undo"></i> ย้อนกลับ</button>`;
            } else if (log.raw_action === 'audit' || logAction.includes("Audit") || logAction.includes("ตรวจนับ")) {
                btnHtml = `<span class="badge bg-light text-muted border px-2 py-2">ปรับยอดด้วยระบบ</span>`;
            } else {
                btnHtml = `<span class="badge bg-light text-muted border px-2 py-2" title="รายการนี้เก่าเกินไป ไม่สามารถย้อนกลับได้">รายการเก่า</span>`;
            }

            // สร้างแถวตาราง
            let row = `
            <tr>
                <td class="text-center text-secondary">${logDate}</td>
                <td class="text-secondary">${logCode}</td>
                <td class="fw-bold" style="white-space: normal; min-width: 150px;">${logName}</td>
                <td class="text-center fw-bold ${actionColor}">${logAction}</td>
                <td class="text-center fw-bold fs-5">${logQty > 0 ? logQty : '-'}</td>
                <td class="text-center text-muted">${logUnit}</td>
                <td class="text-center fw-bold text-info fs-5">${totalBal}</td>
                <td><span class="badge bg-secondary"><i class="fas fa-user me-1"></i>${logUser}</span></td>
                <td class="text-center">${btnHtml}</td>
            </tr>`;
            
            tbody.insertAdjacentHTML('beforeend', row);
        } catch (e) {
            console.error("Error rendering history item:", e, log);
        }
    });

    // ถ้าวนลูปเสร็จแล้วแต่ไม่มีข้อมูลที่ตรงกับคำค้นหา
    if (!hasData) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-danger fw-bold">ไม่พบข้อมูล "${term}" ที่ค้นหา</td></tr>`;
    }
}

function undoTransaction(historyId, histIndex) {
    if (!db || !document.getElementById('syncStatus').innerText.includes('ออนไลน์')) {
        return Swal.fire('ข้อผิดพลาด', 'ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อยกเลิกรายการ', 'error');
    }

    let logToUndo = historyData[histIndex];
    if (!logToUndo || logToUndo.id !== historyId) {
        return Swal.fire('ข้อผิดพลาด', 'ไม่พบข้อมูลรายการที่ต้องการยกเลิก', 'error');
    }

    Swal.fire({
        title: 'ยืนยันการย้อนกลับ?',
        html: `คุณกำลังจะยกเลิกการทำรายการ:<br><b class="text-primary">${logToUndo.name}</b><br>จำนวน: <b class="text-danger">${logToUndo.qty}</b><br><br><span class="text-muted fs-6">* ยอดสต๊อกปัจจุบันจะถูกคืนค่ากลับไปก่อนทำรายการนี้</span>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: '<i class="fas fa-undo"></i> ใช่, ย้อนกลับรายการ',
        cancelButtonText: 'ปิด'
    }).then((result) => {
        if (result.isConfirmed) {
            let itemIdx = allItems.findIndex(i => i && i.code === logToUndo.code);
            if (itemIdx === -1) return Swal.fire('ข้อผิดพลาด', 'ไม่พบรหัสสินค้านี้ในระบบแล้ว', 'error');
            
            let item = allItems[itemIdx];
            let n_main = parseInt(item.main_stock || 0);
            let n_sub = parseInt(item.sub_stock || 0);
            let qty = parseInt(logToUndo.qty || 0);
            let act = logToUndo.raw_action;

            // คืนค่ายอดสต๊อกตามประเภทการกระทำ
            if (act === 'receive_main') n_main -= qty;
            else if (act === 'receive_sub') n_sub -= qty;
            else if (act === 'use') n_sub += qty;
            else if (act === 'transfer_to_sub') { n_main += qty; n_sub -= qty; }
            else if (act === 'transfer_to_main') { n_sub += qty; n_main -= qty; }
            
            if(n_main < 0) n_main = 0;
            if(n_sub < 0) n_sub = 0;

            Swal.fire({title: 'กำลังย้อนกลับ...', allowOutsideClick: false, didOpen: () => Swal.showLoading()});

            db.ref(`inventory_data/${itemIdx}`).update({ main_stock: n_main, sub_stock: n_sub }).then(() => {
                let newHistory = [...historyData];
                newHistory.splice(histIndex, 1);
                
                db.ref('history_data').set(newHistory).then(() => {
                    Swal.fire('สำเร็จ!', 'ทำรายการย้อนกลับและคืนยอดเรียบร้อยแล้ว', 'success');
                });
            }).catch(e => {
                Swal.fire('ข้อผิดพลาด', 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้: ' + e.message, 'error');
            });
        }
    });
}

// ==========================================
// 🌟 ฟังก์ชันจัดการหน้าคิวคนไข้ (Visits Queue) 🌟
// ==========================================
let visitsData = [];

function openVisitView() {
    closeAllViews();
    document.getElementById('visitView').style.display = 'block';
    if(window.innerWidth <= 768) toggleSidebar();
    
    // ตั้งค่ายึดวันที่ปัจจุบัน (พ.ศ.)
    let today = new Date();
    let dd = String(today.getDate()).padStart(2, '0');
    let mm = String(today.getMonth() + 1).padStart(2, '0');
    let yyyy = today.getFullYear() + 543; 
    document.getElementById('visitDateDisplay').innerText = `${dd}/${mm}/${yyyy}`;
    
    loadVisitsData();
}

function loadVisitsData() {
    if(!db) return Swal.fire('ผิดพลาด', 'ระบบออฟไลน์ ไม่สามารถดึงคิวได้', 'error');
    
    document.getElementById('visitListContainer').innerHTML = '<div class="col-12 text-center text-muted py-4"><i class="fas fa-spinner fa-spin fa-2x mb-2"></i><br>กำลังดึงคิวจากฐานข้อมูลคลินิก...</div>';
    
    // ดึงข้อมูล Visit จาก Firebase
    db.ref('patients_database/visits').once('value').then((snap) => {
        visitsData = snap.val() || [];
        renderVisitsList();
    }).catch(err => {
        document.getElementById('visitListContainer').innerHTML = '<div class="col-12 text-center text-danger py-3">เกิดข้อผิดพลาดในการโหลดข้อมูล: ' + err.message + '</div>';
    });
}

function renderVisitsList() {
    const container = document.getElementById('visitListContainer');
    let todayStr = document.getElementById('visitDateDisplay').innerText;

    // กรองเอาเฉพาะคิวของ "วันนี้" เท่านั้น
    let todayVisits = visitsData.filter(v => v && v.date && v.date.split(" ")[0] === todayStr);

    if (todayVisits.length === 0) {
        container.innerHTML = '<div class="col-12 text-center text-muted py-5"><i class="fas fa-bed fa-3x mb-3 text-light"></i><br><h4>ไม่มีคิวผู้ป่วยฟอกไตสำหรับวันนี้</h4></div>';
        return;
    }

    container.innerHTML = '';
    todayVisits.forEach((v) => {
        let statusColor = "warning";
        let statusText = v.status || "รอตรวจ";
        if (statusText.includes("กำลังฟอก")) statusColor = "primary";
        else if (statusText.includes("เสร็จแล้ว") || statusText.includes("ตรวจเสร็จ")) statusColor = "success";
        else if (statusText.includes("ยกเลิก")) statusColor = "danger";

        // วาดการ์ดแสดงประวัติคนไข้แบบดูง่ายบนมือถือ
        let card = `
        <div class="col-12 col-md-6 col-lg-4 mb-3">
            <div class="border rounded p-3 shadow-sm bg-light h-100 d-flex flex-column">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <span class="badge bg-${statusColor} fs-6 px-3 py-2">${statusText}</span>
                    <span class="text-muted fw-bold"><i class="fas fa-clock me-1"></i>${v.time || '-'}</span>
                </div>
                <h4 class="fw-bold text-dark mb-1 mt-2">${v.name}</h4>
                <div class="text-secondary mb-3" style="font-size: 0.95rem;">
                    HN: <b class="text-dark">${v.hn}</b> | เตียง: <b class="text-primary">${v.bed || '-'}</b>
                </div>
                <div class="bg-white rounded border p-2 mb-3" style="font-size: 0.85rem;">
                    <div class="mb-1"><b>สิทธิ:</b> ${v.right || '-'}</div>
                    <div class="mb-1"><b>น้ำเกลือ:</b> <span class="text-info">${v.saline || '-'}</span></div>
                    <div><b>ยาที่ใช้:</b> <span class="text-danger">${v.meds || '-'}</span></div>
                </div>
                
                <button class="btn btn-warning w-100 fw-bold shadow-sm mt-auto" style="color: #495057;" onclick="dispenseToPatient('${v.hn}', '${v.name}')">
                    <i class="fas fa-box-open me-2"></i> จ่ายพัสดุให้รายนี้
                </button>
            </div>
        </div>`;
        container.insertAdjacentHTML('beforeend', card);
    });
}

// เมื่อกดจ่ายพัสดุให้คนไข้ จะกระโดดไปหน้า Manual และเปิดหน้าต่างเบิกพัสดุให้เลย
function dispenseToPatient(hn, name) {
    Swal.fire({
        title: 'เตรียมเบิกพัสดุ',
        html: `กำลังเข้าสู่โหมดเบิกจ่ายให้:<br><b class="text-primary fs-5">${name}</b><br><small class="text-muted">(HN: ${hn})</small>`,
        icon: 'info',
        timer: 1500,
        showConfirmButton: false
    }).then(() => {
        openManualView();
        setTimeout(() => openItemSelector('use'), 400);
    });
}