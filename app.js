// ==========================================
// 🚀 Core Application Logic
// ==========================================
const AppCore = {
    db: null,
    allItems: [],
    historyData: [],
    visitsData: [],
    html5QrCode: null,
    currentUser: "ไม่ระบุ",

    init: function() {
        const params = new URLSearchParams(window.location.search);
        this.currentUser = params.get('user') || "ไม่ระบุ";
        document.getElementById("activeUserDisplay").innerText = "👤 " + this.currentUser;

        try {
            const firebaseConfig = {
                databaseURL: "https://dialysis-inventory-fab4e-default-rtdb.asia-southeast1.firebasedatabase.app/"
            };
            if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
            this.db = firebase.database();
            
            this.db.ref('.info/connected').on('value', (snap) => {
                if (snap.val() === true) {
                    UI.setSyncStatus("ออนไลน์", "success", "wifi");
                    this.loadOnlineData();
                } else {
                    UI.setSyncStatus("ออฟไลน์", "secondary", "database");
                    this.loadLocalData();
                }
            });
        } catch (e) {
            UI.setSyncStatus("ออฟไลน์", "secondary", "database");
            this.loadLocalData();
        }

        setInterval(() => {
            if (!this.db || document.getElementById('syncStatus').innerText.includes('ออฟไลน์')) {
                this.loadLocalData();
            }
        }, 3000);
    },

    loadOnlineData: function() {
        this.db.ref('inventory_data').on('value', (snap) => {
            let data = snap.val() || [];
            this.allItems = Array.isArray(data) ? data : Object.keys(data).map(k => data[k]);
            UI.renderCurrentView();
        });

        this.db.ref('history_data').on('value', (snap) => {
            let data = snap.val() || [];
            this.historyData = (Array.isArray(data) ? data : Object.keys(data).map(k => data[k])).filter(i => i !== null);
            UI.renderCurrentView();
        });

        this.db.ref('patients_database/visits').on('value', (snap) => {
            this.visitsData = snap.val() || [];
            UI.renderCurrentView();
        });
    },

    loadLocalData: function() {
        let t = new Date().getTime();
        fetch('inventory_db.json?t=' + t).then(r => r.json()).then(data => { this.allItems = data; UI.renderCurrentView(); }).catch(()=>{});
        fetch('inventory_history.json?t=' + t).then(r => r.json()).then(data => { this.historyData = data.filter(i => i !== null); UI.renderCurrentView(); }).catch(()=>{});
    },

    // 🌟 ระบบกล้องอัจฉริยะแบบรวมศูนย์ 🌟
    toggleUniversalScanner: function() {
        const rDiv = document.getElementById('scannerContainer');
        if (this.html5QrCode) {
            this.html5QrCode.stop().then(() => {
                this.html5QrCode.clear();
                this.html5QrCode = null;
                rDiv.style.display = 'none';
            }).catch(()=>{});
            return;
        }
        
        rDiv.style.display = 'block';
        document.getElementById('manualBarcode').value = '';
        this.html5QrCode = new Html5Qrcode("universalReader");
        
        const config = { fps: 10, qrbox: { width: 250, height: 250 } };
        this.html5QrCode.start({ facingMode: "environment" }, config, this.onScanSuccess.bind(this), ()=>{})
            .catch(() => {
                this.html5QrCode.start({ facingMode: "user" }, config, this.onScanSuccess.bind(this), ()=>{})
                .catch(() => {
                    Swal.fire("ข้อผิดพลาด", "ไม่สามารถเข้าถึงกล้องได้", "error");
                    rDiv.style.display = 'none';
                    this.html5QrCode = null;
                });
            });
    },

    onScanSuccess: function(decodedText) {
        try { document.getElementById('soundScan').play(); } catch(e) {}
        this.toggleUniversalScanner(); // ปิดกล้อง
        this.handleScanResult(decodedText);
    },

    handleScanResult: function(code) {
        code = code.trim();
        if (!code) return;
        document.getElementById('manualBarcode').value = '';
        
        const idx = this.allItems.findIndex(i => i && i.code === code);
        if (idx > -1) {
            UI.showActionMenu(idx);
        } else {
            Swal.fire({
                title: 'ไม่พบรหัสพัสดุนี้!',
                html: `รหัส: <b class="text-danger">${code}</b><br><br>ระบบยังไม่มีข้อมูลนี้ คุณต้องการลงทะเบียนพัสดุใหม่หรือไม่?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'ลงทะเบียนใหม่',
                cancelButtonText: 'ยกเลิก'
            }).then(res => {
                if(res.isConfirmed) UI.showAddItemForm(code);
            });
        }
    },

    // 🌟 ระบบคำนวณและบันทึก 🌟
    processTransaction: function(idx, action, qty, fromModule = "ทั่วไป") {
        let item = this.allItems[idx];
        let nMain = parseInt(item.main_stock || 0);
        let nSub = parseInt(item.sub_stock || 0);
        let actText = "";

        if (action === 'receive_main') { nMain += qty; actText = "รับเข้าคลังหลัก 📥"; }
        else if (action === 'receive_sub') { nSub += qty; actText = "รับเข้าคลังย่อย 📥"; }
        else if (action === 'use') { 
            if(qty > nSub) return Swal.fire('ผิดพลาด', 'ของในคลังย่อยมีไม่พอจ่าย!', 'error');
            nSub -= qty; actText = "ใช้งานจริง 📤"; 
        }
        else if (action === 'transfer') { 
            if(qty > nMain) return Swal.fire('ผิดพลาด', 'คลังหลักมีไม่พอโอน!', 'error');
            nMain -= qty; nSub += qty; actText = "โอนไปคลังย่อย 🔄"; 
        }

        if (this.db && document.getElementById('syncStatus').innerText.includes('ออนไลน์')) {
            Swal.fire({title: 'กำลังบันทึก...', didOpen: () => Swal.showLoading()});
            
            this.db.ref(`inventory_data/${idx}`).update({ main_stock: nMain, sub_stock: nSub }).then(() => {
                let logId = "HIST-" + new Date().getTime();
                let now = new Date().toLocaleDateString('en-GB') + " " + new Date().toLocaleTimeString('en-GB');
                let log = { id: logId, date: now, code: item.code, name: item.name, action: actText, qty: qty, unit: item.unit, main_bal: nMain, sub_bal: nSub, user: this.currentUser, raw_action: action, module: fromModule };
                
                this.db.ref('history_data').once('value').then(s => {
                    let arr = s.val() || []; arr.unshift(log);
                    this.db.ref('history_data').set(arr);
                    Swal.fire({title: 'บันทึกสำเร็จ!', icon: 'success', timer: 1500, showConfirmButton: false});
                });
            }).catch(e => Swal.fire('Error', e.message, 'error'));
        } else {
            Swal.fire('ข้อผิดพลาด', 'ต้องต่ออินเทอร์เน็ตเพื่อบันทึกข้อมูล', 'error');
        }
    },

    saveBulkAudit: function() {
        Swal.fire({
            title: 'ยืนยันบันทึกยอดตรวจนับ?',
            text: "ระบบจะอัปเดตสต๊อกให้ตรงกับที่คุณพิมพ์",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'บันทึกทั้งหมด',
            confirmButtonColor: '#2ecc71'
        }).then((res) => {
            if (res.isConfirmed) {
                let updates = {}; let logs = []; let count = 0;
                let now = new Date().toLocaleDateString('en-GB') + " " + new Date().toLocaleTimeString('en-GB');

                this.allItems.forEach((item, idx) => {
                    if (!item) return;
                    let mInput = document.getElementById(`audit-m-${idx}`);
                    let sInput = document.getElementById(`audit-s-${idx}`);
                    if (!mInput || !sInput) return;

                    let nMain = parseInt(mInput.value) || 0;
                    let nSub = parseInt(sInput.value) || 0;
                    let oMain = parseInt(item.main_stock || 0);
                    let oSub = parseInt(item.sub_stock || 0);

                    if (nMain !== oMain || nSub !== oSub) {
                        updates[`inventory_data/${idx}/main_stock`] = nMain;
                        updates[`inventory_data/${idx}/sub_stock`] = nSub;
                        logs.push({ id: "HIST-" + new Date().getTime() + "-" + idx, date: now, code: item.code, name: item.name, action: "ปรับยอด (Spot Audit) 📋", qty: 0, unit: item.unit, main_bal: nMain, sub_bal: nSub, user: this.currentUser, raw_action: 'audit' });
                        count++;
                    }
                });

                if (count === 0) return Swal.fire('ไม่มีการเปลี่ยนแปลง', 'ยอดตรงกับระบบอยู่แล้ว', 'info');

                if (this.db) {
                    Swal.fire({title: 'กำลังบันทึก...', didOpen: () => Swal.showLoading()});
                    this.db.ref().update(updates).then(() => {
                        this.db.ref('history_data').once('value').then(s => {
                            let arr = s.val() || []; arr = logs.concat(arr);
                            this.db.ref('history_data').set(arr);
                            Swal.fire('สำเร็จ!', `ปรับยอดใหม่ ${count} รายการ`, 'success');
                            UI.switchTab('view-dashboard', document.querySelector('.bottom-nav a:first-child'));
                        });
                    });
                }
            }
        });
    }
};

// ==========================================
// 🎨 UI Rendering Logic (สร้างหน้าตาแอป)
// ==========================================
const UI = {
    currentTabId: 'view-dashboard',

    setSyncStatus: function(text, color, icon) {
        const el = document.getElementById('syncStatus');
        el.className = `badge bg-${color} me-2`;
        el.innerHTML = `<i class="fas fa-${icon} me-1"></i> ${text}`;
    },

    switchTab: function(tabId, element) {
        document.querySelectorAll('.main-content').forEach(el => el.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');
        
        document.querySelectorAll('.bottom-nav .nav-item').forEach(el => el.classList.remove('active'));
        if(element) element.classList.add('active');

        this.currentTabId = tabId;
        this.renderCurrentView();
    },

    renderCurrentView: function() {
        if (this.currentTabId === 'view-dashboard') this.renderDashboard();
        else if (this.currentTabId === 'view-visits') this.renderVisits();
        else if (this.currentTabId === 'view-audit') this.renderAudit();
        else if (this.currentTabId === 'view-history') this.renderHistory();
    },

    // 📦 1. Dashboard (คลังหลัก)
    renderDashboard: function() {
        const term = (document.getElementById('searchDashboard') ? document.getElementById('searchDashboard').value.toLowerCase() : '');
        const cardCont = document.getElementById('dashboardCardContainer');
        const tableCont = document.getElementById('dashboardTableBody');
        cardCont.innerHTML = ''; tableCont.innerHTML = '';

        let items = AppCore.allItems.map((item, index) => ({item, index})).filter(x => x.item && x.item.name);
        items.sort((a, b) => (parseFloat(a.item.seq_num) || 9999) - (parseFloat(b.item.seq_num) || 9999));

        let hasData = false;
        items.forEach(f => {
            let i = f.item, idx = f.index;
            if (term && !i.name.toLowerCase().includes(term) && !(i.code||"").toLowerCase().includes(term) && !(i.category||"").toLowerCase().includes(term)) return;
            hasData = true;

            let main = parseInt(i.main_stock || 0), sub = parseInt(i.sub_stock || 0), total = main + sub;
            let mColor = main > 10 ? 'success' : (main > 0 ? 'warning' : 'danger');

            // Card แบบมือถือ
            cardCont.innerHTML += `
            <div class="col-12 col-sm-6">
                <div class="item-card" onclick="UI.showActionMenu(${idx})">
                    <div style="flex:1;">
                        <span class="badge bg-secondary mb-1">${i.code}</span>
                        <div class="fw-bold text-dark lh-sm mb-1">${i.name}</div>
                        <div class="text-muted" style="font-size:0.8rem;">${i.category}</div>
                    </div>
                    <div class="text-end ms-2">
                        <div class="fs-4 fw-bold text-${mColor}">${main} <span class="fs-6 text-muted">${i.unit || 'ชิ้น'}</span></div>
                        <div style="font-size:0.8rem; color:#e74c3c;">ย่อย: ${sub}</div>
                    </div>
                </div>
            </div>`;

            // Table แบบคอมพิวเตอร์
            tableCont.innerHTML += `
            <tr style="cursor:pointer;" onclick="UI.showActionMenu(${idx})">
                <td class="text-secondary">${i.code}</td>
                <td><b class="text-dark">${i.name}</b><br><small class="text-muted">${i.category}</small></td>
                <td class="text-center text-${mColor} fw-bold fs-5">${main}</td>
                <td class="text-center text-danger fw-bold">${sub}</td>
                <td class="text-center text-primary fw-bold fs-5">${total}</td>
                <td class="text-center"><button class="btn btn-sm btn-outline-primary"><i class="fas fa-bolt"></i> จัดการ</button></td>
            </tr>`;
        });

        if(!hasData) cardCont.innerHTML = `<div class="text-center py-4 text-muted">ไม่พบข้อมูลพัสดุ</div>`;
    },

    // 🛏️ 2. คิวคนไข้ (Visits)
    renderVisits: function() {
        const cont = document.getElementById('visitListContainer');
        let today = new Date();
        let todayStr = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()+543}`;
        document.getElementById('visitDateBadge').innerText = todayStr;

        let todayVisits = AppCore.visitsData.filter(v => v && v.date && v.date.split(" ")[0] === todayStr);

        if (todayVisits.length === 0) {
            cont.innerHTML = '<div class="text-center text-muted py-5"><i class="fas fa-bed fa-3x mb-3"></i><br>ไม่มีคิวฟอกไตสำหรับวันนี้</div>';
            return;
        }

        cont.innerHTML = '';
        todayVisits.forEach((v) => {
            let sColor = v.status.includes("กำลังฟอก") ? "primary" : (v.status.includes("เสร็จ") ? "success" : "warning");
            cont.innerHTML += `
            <div class="col-12 col-md-6 col-lg-4">
                <div class="modern-card border-top border-${sColor} border-4">
                    <div class="d-flex justify-content-between mb-2">
                        <span class="badge bg-${sColor}">${v.status}</span>
                        <span class="text-muted fw-bold"><i class="fas fa-clock"></i> ${v.time || '-'}</span>
                    </div>
                    <h5 class="fw-bold mb-1">${v.name}</h5>
                    <div class="text-muted fs-6 mb-3">HN: ${v.hn} | เตียง: ${v.bed}</div>
                    <div class="bg-light p-2 rounded mb-3" style="font-size:0.85rem;">
                        <div><b>ยาที่ใช้:</b> <span class="text-danger">${v.meds || '-'}</span></div>
                        <div><b>น้ำเกลือ:</b> <span class="text-info">${v.saline || '-'}</span></div>
                    </div>
                    <button class="btn btn-outline-primary w-100 fw-bold" onclick="UI.openDispenseModal('${v.hn}', '${v.name}')">
                        <i class="fas fa-box-open me-2"></i> จ่ายยา / เวชภัณฑ์
                    </button>
                </div>
            </div>`;
        });
    },

    openDispenseModal: function(hn, name) {
        // ให้เด้งกลับไปหน้าสแกน (คลังหลัก) พร้อมขึ้นชื่อคนไข้
        Swal.fire({
            title: 'เตรียมจ่ายพัสดุ',
            html: `ระบบกำลังเข้าโหมดสแกนจ่ายพัสดุให้คุณ:<br><b class="text-primary fs-4">${name}</b>`,
            icon: 'info',
            timer: 1500,
            showConfirmButton: false
        }).then(() => {
            this.switchTab('view-dashboard', document.querySelector('.bottom-nav a:first-child'));
            setTimeout(() => AppCore.toggleUniversalScanner(), 500);
        });
    },

    // 📋 3. ตรวจนับสต๊อก (Audit)
    renderAudit: function() {
        const cont = document.getElementById('auditListContainer');
        cont.innerHTML = '';
        
        let items = AppCore.allItems.map((item, index) => ({item, index})).filter(x => x.item && x.item.name);
        items.forEach(f => {
            let i = f.item, idx = f.index;
            cont.innerHTML += `
            <div class="col-12 col-md-6">
                <div class="item-card flex-column align-items-start border-secondary">
                    <div class="fw-bold mb-2 text-dark w-100 d-flex justify-content-between">
                        <span>${i.name}</span>
                        <span class="badge bg-info">ในระบบ: ${(parseInt(i.main_stock)||0) + (parseInt(i.sub_stock)||0)}</span>
                    </div>
                    <div class="d-flex w-100 gap-2">
                        <div class="flex-fill">
                            <label class="text-muted" style="font-size:0.8rem;">หลัก</label>
                            <input type="number" id="audit-m-${idx}" class="form-control text-center fw-bold" value="${i.main_stock||0}" onclick="this.select()">
                        </div>
                        <div class="flex-fill">
                            <label class="text-danger" style="font-size:0.8rem;">ย่อย</label>
                            <input type="number" id="audit-s-${idx}" class="form-control text-center text-danger fw-bold border-danger" value="${i.sub_stock||0}" onclick="this.select()">
                        </div>
                    </div>
                </div>
            </div>`;
        });
    },

    // 📜 4. ประวัติ (History)
    renderHistory: function() {
        const cont = document.getElementById('historyListContainer');
        cont.innerHTML = '';
        
        if (!AppCore.historyData || AppCore.historyData.length === 0) {
            return cont.innerHTML = '<div class="text-center text-muted py-4">ไม่มีประวัติทำรายการ</div>';
        }

        AppCore.historyData.slice(0, 50).forEach(log => {
            let aColor = "secondary";
            if (log.action.includes("รับเข้า")) aColor = "success";
            else if (log.action.includes("ใช้งาน")) aColor = "warning";
            else if (log.action.includes("โอน")) aColor = "primary";

            cont.innerHTML += `
            <div class="col-12">
                <div class="bg-white p-3 rounded mb-2 shadow-sm border-start border-4 border-${aColor}">
                    <div class="d-flex justify-content-between mb-1">
                        <span class="badge bg-light text-dark border">${log.date}</span>
                        <span class="text-${aColor} fw-bold"><i class="fas fa-caret-right"></i> ${log.action}</span>
                    </div>
                    <div class="fw-bold text-dark">${log.name}</div>
                    <div class="d-flex justify-content-between align-items-center mt-2">
                        <span class="fs-5 fw-bold ${aColor === 'warning' ? 'text-danger' : 'text-dark'}">${log.qty > 0 ? log.qty + ' ' + log.unit : ''}</span>
                        <span class="text-muted" style="font-size:0.8rem;">ผู้ทำ: ${log.user}</span>
                    </div>
                </div>
            </div>`;
        });
    },

    // 🧰 เมนูจัดการเมื่อคลิกพัสดุ
    showActionMenu: function(idx) {
        const item = AppCore.allItems[idx];
        Swal.fire({
            html: `
                <div class="text-start">
                    <span class="badge bg-secondary mb-2">${item.code}</span>
                    <h5 class="fw-bold text-primary mb-3">${item.name}</h5>
                    <div class="d-flex justify-content-around p-2 bg-light rounded mb-3">
                        <div class="text-center">สต๊อกหลัก<br><b class="fs-4">${item.main_stock||0}</b></div>
                        <div class="text-center text-danger">สต๊อกย่อย<br><b class="fs-4">${item.sub_stock||0}</b></div>
                    </div>
                    
                    <label class="fw-bold mb-1">ระบุจำนวน:</label>
                    <input type="number" id="quickQty" class="form-control form-control-lg text-center fw-bold text-primary mb-3" value="1" onclick="this.select()">
                    
                    <div class="d-grid gap-2">
                        <button class="btn btn-warning py-3 fw-bold" onclick="UI.executeAction(${idx}, 'use')"><i class="fas fa-upload me-2"></i> ตัดสต๊อก (ใช้งาน)</button>
                        <button class="btn btn-primary py-3 fw-bold text-white" onclick="UI.executeAction(${idx}, 'transfer')"><i class="fas fa-exchange-alt me-2"></i> โอน (หลัก ➡️ ย่อย)</button>
                        <button class="btn btn-success py-3 fw-bold" onclick="UI.executeAction(${idx}, 'receive_main')"><i class="fas fa-download me-2"></i> รับของเข้า (คลังหลัก)</button>
                    </div>
                </div>
            `,
            showConfirmButton: false, showCancelButton: true, cancelButtonText: 'ปิดหน้าต่าง'
        });
    },

    executeAction: function(idx, action) {
        let qty = parseInt(document.getElementById('quickQty').value);
        if(!qty || qty <= 0) return Swal.showValidationMessage('ใส่จำนวนที่ถูกต้อง');
        Swal.close();
        AppCore.processTransaction(idx, action, qty);
    },

    showAddItemForm: function(scannedCode = "") {
        Swal.fire({
            title: '➕ ลงทะเบียนพัสดุ',
            html: `
                <div class="text-start" style="font-size:0.9rem;">
                    <label>รหัสบาร์โค้ด</label>
                    <input id="newCode" class="form-control mb-2" value="${scannedCode}">
                    <label>ชื่อพัสดุ</label>
                    <input id="newName" class="form-control mb-2" placeholder="ระบุชื่อ...">
                    <div class="row">
                        <div class="col-6"><label>หน่วยนับ</label><input id="newUnit" class="form-control mb-2" placeholder="ชิ้น"></div>
                        <div class="col-6"><label>หมวดหมู่</label><input id="newCat" class="form-control mb-2" placeholder="อื่นๆ"></div>
                    </div>
                </div>
            `,
            confirmButtonText: 'บันทึก', showCancelButton: true,
            preConfirm: () => {
                let code = document.getElementById('newCode').value;
                let name = document.getElementById('newName').value;
                if(!code || !name) return Swal.showValidationMessage('กรอกรหัสและชื่อให้ครบ');
                
                let newItem = {
                    id: "ITM" + new Date().getTime(),
                    seq_num: AppCore.allItems.length + 1, code: code, name: name,
                    category: document.getElementById('newCat').value || "อื่นๆ", unit: document.getElementById('newUnit').value || "ชิ้น",
                    main_stock: 0, sub_stock: 0, target_stock: 0, min_alert: 10, price: 0
                };

                let nextIdx = AppCore.allItems.length;
                AppCore.db.ref(`inventory_data/${nextIdx}`).set(newItem).then(() => {
                    Swal.fire('สำเร็จ', 'เพิ่มพัสดุเรียบร้อย', 'success');
                });
            }
        });
    }
};

// เริ่มต้นระบบเมื่อโหลดหน้าเว็บเสร็จ
document.addEventListener("DOMContentLoaded", () => AppCore.init());