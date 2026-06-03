// ==========================================
// 🚀 Core Application Logic
// ==========================================
const AppCore = {
    db: null,
    allItems: [],
    historyData: [],
    visitsData: [],
    html5QrCode: null,
    popupScannerInst: null,
    currentUser: "ไม่ระบุ",
    currentCalcTargetId: "",
    scanContext: null, // ตัวแปรเก็บสถานะว่ากำลังสแกนเพื่อทำอะไร

    init: function() {
        const params = new URLSearchParams(window.location.search);
        this.currentUser = params.get('user') || "ไม่ระบุ";
        const userDisplay = document.getElementById("activeUserDisplay");
        if (userDisplay) userDisplay.innerText = "👤 " + this.currentUser;

        window.history.pushState(null, null, window.location.href);
        window.onpopstate = function(event) {
            window.history.pushState(null, null, window.location.href);
            if (document.getElementById('scannerContainer') && document.getElementById('scannerContainer').style.display === 'block') {
                AppCore.toggleUniversalScanner(); return;
            }
            if (Swal.isVisible()) { Swal.close(); return; }
            Swal.fire({ toast: true, position: 'top', icon: 'warning', title: 'กรุณาใช้เมนูด้านล่างในการสลับหน้าครับ', showConfirmButton: false, timer: 2000 });
        };

        try {
            const firebaseConfig = { databaseURL: "https://dialysis-inventory-fab4e-default-rtdb.asia-southeast1.firebasedatabase.app/" };
            if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
            this.db = firebase.database();
            
            this.db.ref('.info/connected').on('value', (snap) => {
                if (snap.val() === true) { UI.setSyncStatus("ออนไลน์", "success", "wifi"); this.loadOnlineData(); } 
                else { UI.setSyncStatus("ออฟไลน์", "secondary", "database"); this.loadLocalData(); }
            });
        } catch (e) { UI.setSyncStatus("ออฟไลน์", "secondary", "database"); this.loadLocalData(); }
    },

    logoutApp: function() {
        Swal.fire({
            title: 'ออกจากระบบ?', text: "คุณต้องการออกจากระบบคลังพัสดุใช่หรือไม่?", icon: 'question',
            showCancelButton: true, confirmButtonText: 'ออกจากระบบ', cancelButtonText: 'ยกเลิก', confirmButtonColor: '#e74c3c'
        }).then((res) => { if (res.isConfirmed) window.location.replace("scanner_login.html?v=" + new Date().getTime()); });
    },

    loadOnlineData: function() {
        this.db.ref('inventory_data').on('value', (snap) => { 
            let data = snap.val();
            let rawItems = data ? (Array.isArray(data) ? data : Object.keys(data).map(k => data[k])) : []; 
            this.allItems = rawItems.filter(i => i !== null).sort((a, b) => (parseFloat(a.seq_num) || 9999) - (parseFloat(b.seq_num) || 9999));
            if(UI.currentTabId !== 'view-audit') UI.renderCurrentView(); 
        });

        this.db.ref('history_data').limitToLast(150).on('value', (snap) => { 
            let data = snap.val(); 
            let rawHistory = data ? (Array.isArray(data) ? data : Object.keys(data).map(k => data[k])) : []; 
            this.historyData = rawHistory.filter(i => i !== null).sort((a, b) => {
                let idA = a.id ? a.id.replace("HIST-", "") : "0";
                let idB = b.id ? b.id.replace("HIST-", "") : "0";
                return parseInt(idB) - parseInt(idA);
            });
            if(UI.currentTabId === 'view-history') UI.renderCurrentView(); 
        });

        this.db.ref('patients_database/visits').on('value', (snap) => { 
            let data = snap.val();
            this.visitsData = data ? data : []; 
            if(UI.currentTabId === 'view-visits') UI.renderCurrentView(); 
        });
    },

    loadLocalData: function() {
        let t = new Date().getTime();
        fetch('inventory_db.json?t=' + t).then(r => r.json()).then(data => { 
            this.allItems = (data || []).filter(i => i !== null).sort((a, b) => (parseFloat(a.seq_num) || 9999) - (parseFloat(b.seq_num) || 9999));
            if(UI.currentTabId !== 'view-audit') UI.renderCurrentView(); 
        }).catch(()=>{});
        
        fetch('inventory_history.json?t=' + t).then(r => r.json()).then(data => { 
            this.historyData = (data || []).filter(i => i !== null).reverse(); 
            if(UI.currentTabId === 'view-history') UI.renderCurrentView(); 
        }).catch(()=>{});
    },

    toggleUniversalScanner: function() {
        const rDiv = document.getElementById('scannerContainer');
        if (!rDiv) return;
        
        if (this.html5QrCode) {
            this.html5QrCode.stop().then(() => { this.html5QrCode.clear(); this.html5QrCode = null; rDiv.style.display = 'none'; this.scanContext = null; }).catch(()=>{});
            return;
        }
        rDiv.style.display = 'block'; 
        const manInput = document.getElementById('manualBarcode');
        if (manInput) manInput.value = '';
        
        this.html5QrCode = new Html5Qrcode("universalReader");
        const config = { fps: 10, qrbox: { width: 250, height: 250 } };
        this.html5QrCode.start({ facingMode: "environment" }, config, this.onScanSuccess.bind(this), ()=>{})
            .catch(() => {
                this.html5QrCode.start({ facingMode: "user" }, config, this.onScanSuccess.bind(this), ()=>{})
                .catch(() => { Swal.fire("ข้อผิดพลาด", "ไม่สามารถเข้าถึงกล้องได้", "error"); rDiv.style.display = 'none'; this.html5QrCode = null; });
            });
    },

    onScanSuccess: function(decodedText) {
        try { document.getElementById('soundScan').play(); } catch(e) {}
        this.toggleUniversalScanner(); 
        this.handleScanResult(decodedText);
    },

    // 🌟 ฟังก์ชันหลัก: ตัดสินใจว่าจะทำอะไรเมื่อสแกนเจอบาร์โค้ด 🌟
    handleScanResult: function(code) {
        code = code.trim(); if (!code) return;
        const manInput = document.getElementById('manualBarcode');
        if (manInput) manInput.value = '';
        
        const idx = this.allItems.findIndex(i => i && i.code === code);
        
        // 1. ถ้าสแกนจากปุ่ม "จ่ายยาให้คนไข้"
        if (this.scanContext && this.scanContext.mode === 'dispense') {
            if (idx > -1) {
                UI.showActionMenu(idx, `เบิกจ่ายให้: ${this.scanContext.name}`);
            } else {
                Swal.fire('ไม่พบพัสดุ', `ไม่พบรหัสบาร์โค้ด ${code} ในระบบคลัง`, 'error');
            }
            this.scanContext = null; // คืนค่า
        } 
        // 2. ถ้าสแกนจากปุ่มลอย (Floating Action Button) ให้ทำงานตามหน้าปัจจุบัน
        else {
            if (idx > -1) { 
                if (UI.currentTabId === 'view-audit') {
                    // 👉 ถ้าอยู่หน้าตรวจนับ: ให้เปิดป๊อปอัปกรอกตัวเลขตรวจนับของสินค้านั้น
                    UI.showAuditQuickInput(idx);
                } 
                else if (UI.currentTabId === 'view-history') {
                    // 👉 ถ้าอยู่หน้าประวัติ: ให้ค้นหาประวัติของสินค้านี้
                    const searchInput = document.getElementById('searchHistory');
                    if (searchInput) { 
                        searchInput.value = code; 
                        UI.renderHistory(); 
                    }
                    Swal.fire({toast: true, position: 'top', icon: 'success', title: `ค้นหาประวัติ: ${code}`, showConfirmButton: false, timer: 1500});
                } 
                else {
                    // 👉 หน้าอื่นๆ (คลังหลัก): เปิดเมนูจัดการปกติ
                    UI.showActionMenu(idx); 
                }
            } 
            else {
                Swal.fire({
                    title: 'ไม่พบรหัสพัสดุนี้!', html: `รหัส: <b class="text-danger">${code}</b><br><br>ระบบยังไม่มีข้อมูลนี้ ลงทะเบียนพัสดุใหม่หรือไม่?`,
                    icon: 'question', showCancelButton: true, confirmButtonText: 'ลงทะเบียนใหม่', cancelButtonText: 'ยกเลิก'
                }).then(res => { if(res.isConfirmed) this.showAddItemForm(code); });
            }
        }
    },

    getCategoryOptionsHTML: function() {
        let cats = new Set(["เวชภัณฑ์ทางการแพทย์", "อุปกรณ์สำนักงาน", "น้ำยา/อุปกรณ์ทำความสะอาด", "น้ำยาไต (ทั่วไป)", "อื่นๆ"]);
        (this.allItems || []).forEach(item => { if(item && item.category && item.category.length < 40) cats.add(item.category); });
        return Array.from(cats).map(cat => `<option value="${cat}">`).join('');
    },

    generateRandomCodePopup: function(inputId) {
        const prefix = "ITM-"; 
        const randomNum = Math.floor(1000 + Math.random() * 9000); 
        const inputElem = document.getElementById(inputId);
        if (inputElem) inputElem.value = prefix + randomNum;
    },

    startPopupScanner: function(readerId, inputId) {
        const readerDiv = document.getElementById(readerId);
        if (!readerDiv) return;
        
        readerDiv.style.display = 'block';
        if (this.popupScannerInst) this.popupScannerInst.clear();
        this.popupScannerInst = new Html5QrcodeScanner(readerId, { fps: 10, qrbox: { width: 220, height: 220 } }, false);
        this.popupScannerInst.render((decodedText) => {
            const inputElem = document.getElementById(inputId);
            if (inputElem) inputElem.value = decodedText;
            this.popupScannerInst.clear(); readerDiv.style.display = 'none';
            try { document.getElementById('soundScan').play(); } catch(e) {}
        }, (error) => {});
    },

    showAddItemForm: function(scannedCode = "") {
        let defaultSeq = (this.allItems || []).length + 1;
        Swal.fire({
            title: '➕ ลงทะเบียนพัสดุใหม่', width: '600px',
            html: `
                <div class="text-start mt-2" style="font-family: 'Sarabun', sans-serif; font-size: 0.9rem;">
                    <div class="row">
                        <div class="col-4 mb-2"><label class="form-label fw-bold">ลำดับ</label><input id="swal-seq" class="form-control" value="${defaultSeq}"></div>
                        <div class="col-8 mb-2"><label class="form-label fw-bold text-primary">หมวดหมู่</label><input type="text" id="swal-cat" list="catList" class="form-control border-primary" placeholder="พิมพ์ใหม่ หรือเลือก..."><datalist id="catList">${this.getCategoryOptionsHTML()}</datalist></div>
                    </div>
                    <div class="row">
                        <div class="col-md-6 mb-2">
                            <label class="form-label fw-bold">รหัสพัสดุ (Code)</label>
                            <div class="input-group">
                                <input id="swal-code" class="form-control" placeholder="เช่น A01" value="${scannedCode}">
                                <button type="button" class="btn btn-warning text-dark px-2" onclick="AppCore.generateRandomCodePopup('swal-code')"><i class="fas fa-dice"></i></button>
                                <button type="button" class="btn btn-info text-white px-2" onclick="AppCore.startPopupScanner('readerPopup', 'swal-code')"><i class="fas fa-camera"></i></button>
                            </div>
                            <div id="readerPopup" style="display: none; width: 100%; margin-top: 8px; border-radius: 8px; overflow: hidden; border: 2px solid #17a2b8;"></div>
                        </div>
                        <div class="col-md-6 mb-2"><label class="form-label fw-bold">ชื่อพัสดุ / อุปกรณ์</label><input id="swal-name" class="form-control" placeholder="ระบุชื่อพัสดุ"></div>
                    </div>
                    <div class="row">
                        <div class="col-4 mb-2"><label class="form-label fw-bold">หน่วยนับ</label><input id="swal-unit" class="form-control" placeholder="ชิ้น"></div>
                        <div class="col-4 mb-2"><label class="form-label fw-bold">บรรจุ/กล่อง</label><input type="number" id="swal-per-box" class="form-control" value="1"></div>
                        <div class="col-4 mb-2"><label class="form-label fw-bold">ราคา (บาท)</label><input type="number" id="swal-price" class="form-control" value="0"></div>
                    </div>
                    <div class="row bg-light p-2 rounded mx-0 mt-1">
                        <div class="col-4 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.8rem;">ใช้เฉลี่ย/ด.</label><input type="number" id="swal-usage" class="form-control text-center" value="0"></div>
                        <div class="col-4 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.8rem;">ยอดตั้งต้น</label><input type="number" id="swal-target" class="form-control text-center" value="0"></div>
                        <div class="col-4 px-1"><label class="form-label fw-bold text-danger" style="font-size: 0.8rem;">แจ้งเตือนหมด</label><input type="number" id="swal-min" class="form-control text-center" value="10"></div>
                    </div>
                </div>
            `,
            showCancelButton: true, confirmButtonText: '<i class="fas fa-save"></i> บันทึกข้อมูล', confirmButtonColor: '#2ecc71', cancelButtonText: 'ยกเลิก',
            preConfirm: () => { 
                return { 
                    seq_num: document.getElementById('swal-seq').value.trim() || defaultSeq, 
                    code: document.getElementById('swal-code').value.trim(), 
                    name: document.getElementById('swal-name').value.trim(), 
                    category: document.getElementById('swal-cat').value || "อื่นๆ", 
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
                if(!res.value.name || !res.value.code) return Swal.fire('ผิดพลาด', 'กรุณากรอกรหัสและชื่อให้ครบ', 'warning');
                if ((this.allItems || []).some(i => i && i.code === res.value.code)) return Swal.fire('ผิดพลาด', 'รหัสบาร์โค้ดนี้มีในระบบแล้ว!', 'error');
                
                let newItem = { id: "ITM" + new Date().getTime(), ...res.value, main_stock: res.value.target_stock, sub_stock: 0, req_qty: "", req_note: "" };
                let nextIdx = 0;
                // หา Index ที่ว่างที่สุดเพื่อป้องกันข้อมูลทับกัน
                while(this.allItems[nextIdx] !== undefined) nextIdx++;
                
                const syncStatus = document.getElementById('syncStatus');
                if (this.db && syncStatus && syncStatus.innerText.includes('ออนไลน์')) {
                    this.db.ref(`inventory_data/${nextIdx}`).set(newItem).then(() => Swal.fire('สำเร็จ', 'เพิ่มพัสดุใหม่เรียบร้อย', 'success'));
                } else { Swal.fire('ข้อผิดพลาด', 'ต้องต่ออินเทอร์เน็ตเพื่อเพิ่มพัสดุใหม่', 'error'); }
            }
        });
    },

    editItemForm: function(idx) {
        const item = this.allItems[idx];
        if (!item) return;

        Swal.fire({
            title: '📝 แก้ไขข้อมูลพัสดุ', width: '600px',
            html: `
                <div class="text-start mt-2" style="font-family: 'Sarabun', sans-serif; font-size: 0.9rem;">
                    <div class="row">
                        <div class="col-4 mb-2"><label class="form-label fw-bold">ลำดับ</label><input id="edit-seq" class="form-control" value="${item.seq_num || ''}"></div>
                        <div class="col-8 mb-2"><label class="form-label fw-bold text-primary">หมวดหมู่</label><input type="text" id="edit-cat" list="catListEdit" class="form-control border-primary" value="${item.category || ''}"><datalist id="catListEdit">${this.getCategoryOptionsHTML()}</datalist></div>
                    </div>
                    <div class="row">
                        <div class="col-md-6 mb-2">
                            <label class="form-label fw-bold">รหัสพัสดุ (Code)</label>
                            <div class="input-group">
                                <input id="edit-code" class="form-control" value="${item.code || ''}" readonly>
                            </div>
                        </div>
                        <div class="col-md-6 mb-2"><label class="form-label fw-bold">ชื่อพัสดุ</label><input id="edit-name" class="form-control" value="${item.name || ''}"></div>
                    </div>
                    <div class="row">
                        <div class="col-4 mb-2"><label class="form-label fw-bold">หน่วยนับ</label><input id="edit-unit" class="form-control" value="${item.unit || 'ชิ้น'}"></div>
                        <div class="col-4 mb-2"><label class="form-label fw-bold">บรรจุ/กล่อง</label><input type="number" id="edit-per-box" class="form-control" value="${item.qty_per_box || ''}"></div>
                        <div class="col-4 mb-2"><label class="form-label fw-bold">ราคา (บาท)</label><input type="number" id="edit-price" class="form-control" value="${item.price || ''}"></div>
                    </div>
                    <div class="row bg-light p-2 rounded mx-0 mt-1">
                        <div class="col-4 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.8rem;">ใช้เฉลี่ย/ด.</label><input type="number" id="edit-usage" class="form-control text-center" value="${item.monthly_usage || ''}"></div>
                        <div class="col-4 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.8rem;">ยอดตั้งต้น</label><input type="number" id="edit-target" class="form-control text-center" value="${item.target_stock || ''}"></div>
                        <div class="col-4 px-1"><label class="form-label fw-bold text-danger" style="font-size: 0.8rem;">แจ้งเตือนต่ำกว่า</label><input type="number" id="edit-min" class="form-control text-center" value="${item.min_alert || ''}"></div>
                    </div>
                </div>
            `,
            showCancelButton: true, confirmButtonText: '<i class="fas fa-save"></i> บันทึกการแก้ไข', confirmButtonColor: '#3498db', cancelButtonText: 'ยกเลิก',
            preConfirm: () => { 
                return { 
                    seq_num: document.getElementById('edit-seq').value.trim(), 
                    name: document.getElementById('edit-name').value.trim(), 
                    category: document.getElementById('edit-cat').value || "อื่นๆ", 
                    unit: document.getElementById('edit-unit').value.trim() || 'ชิ้น', 
                    qty_per_box: document.getElementById('edit-per-box').value || "1", 
                    price: parseFloat(document.getElementById('edit-price').value) || 0, 
                    monthly_usage: parseFloat(document.getElementById('edit-usage').value) || 0, 
                    target_stock: parseInt(document.getElementById('edit-target').value) || 0, 
                    min_alert: parseInt(document.getElementById('edit-min').value) || 10 
                } 
            }
        }).then(res => {
            if (res.isConfirmed) {
                if(!res.value.name) return Swal.fire('ผิดพลาด', 'กรุณากรอกชื่อให้ครบ', 'warning');
                const syncStatus = document.getElementById('syncStatus');
                if (this.db && syncStatus && syncStatus.innerText.includes('ออนไลน์')) {
                    // ใช้ชื่อ Key เดิมของ Firebase ในการอัปเดต
                    this.db.ref('inventory_data').orderByChild('code').equalTo(item.code).once('value', snapshot => {
                        if(snapshot.exists()){
                            let fbKey = Object.keys(snapshot.val())[0];
                            this.db.ref(`inventory_data/${fbKey}`).update(res.value).then(() => Swal.fire('สำเร็จ', 'แก้ไขข้อมูลเรียบร้อย', 'success'));
                        }
                    });
                }
            }
        });
    },

    openCalculator: function(targetId, currentValue) {
        this.currentCalcTargetId = targetId;
        const disp = document.getElementById('calcDisplay');
        if (disp) disp.value = currentValue || '';
        const modalEl = document.getElementById('calculatorModal');
        if (modalEl) new bootstrap.Modal(modalEl).show();
    },
    calcAppend: function(val) { const d = document.getElementById('calcDisplay'); if (d) { d.value += val; d.scrollLeft = d.scrollWidth; } },
    calcBackspace: function() { let d = document.getElementById('calcDisplay'); if (d) { d.value = d.value.slice(0, -1); d.scrollLeft = d.scrollWidth; } },
    calcClear: function() { const d = document.getElementById('calcDisplay'); if (d) d.value = ''; },
    calcConfirm: function() {
        const disp = document.getElementById('calcDisplay');
        if (!disp) return;
        let expr = disp.value; let finalVal = 0;
        if(/^[0-9+\-*/.\s]+$/.test(expr)) { try { let res = eval(expr); if(isFinite(res)) finalVal = Math.floor(res); } catch(e) {} }
        if(isNaN(finalVal) || finalVal < 0) finalVal = 0;

        let el = document.getElementById(this.currentCalcTargetId);
        if(el) {
            el.value = finalVal;
            if (this.currentCalcTargetId.includes("audit-")) {
                let idxStr = this.currentCalcTargetId.split('-').pop();
                let mElem = document.getElementById(`audit-m-${idxStr}`);
                let sElem = document.getElementById(`audit-s-${idxStr}`);
                let m = mElem ? (parseInt(mElem.value) || 0) : 0;
                let s = sElem ? (parseInt(sElem.value) || 0) : 0;
                let badge = document.getElementById(`audit-badge-${idxStr}`);
                if(badge) badge.innerText = "รวมนับได้: " + (m + s);
            }
        }
        const modalEl = document.getElementById('calculatorModal');
        if (modalEl) { const modalInst = bootstrap.Modal.getInstance(modalEl); if (modalInst) modalInst.hide(); }
    },

    processTransaction: function(idx, action, qty, fromModule = "ทั่วไป") {
        let item = this.allItems[idx];
        if (!item) return;
        
        let nMain = parseInt(item.main_stock || 0), nSub = parseInt(item.sub_stock || 0), actText = "";

        if (action === 'receive_main') { nMain += qty; actText = "รับเข้าคลังหลัก 📥"; }
        else if (action === 'use') { 
            if(qty > nSub) return Swal.fire('ผิดพลาด', 'ของในคลังย่อยมีไม่พอจ่าย!', 'error');
            nSub -= qty; actText = "ใช้งานจริง 📤"; 
        }
        else if (action === 'transfer') { 
            if(qty > nMain) return Swal.fire('ผิดพลาด', 'คลังหลักมีไม่พอโอน!', 'error');
            nMain -= qty; nSub += qty; actText = "โอนไปคลังย่อย 🔄"; 
        }
        else if (action === 'transfer_back') {
            if(qty > nSub) return Swal.fire('ผิดพลาด', 'คลังย่อยมีของไม่พอคืน!', 'error');
            nSub -= qty; nMain += qty; actText = "คืนเข้าคลังหลัก 🔄";
        }

        const syncStatus = document.getElementById('syncStatus');
        if (this.db && syncStatus && syncStatus.innerText.includes('ออนไลน์')) {
            Swal.fire({title: 'กำลังบันทึก...', didOpen: () => Swal.showLoading()});
            
            // ค้นหา Key ที่แท้จริงใน Firebase ก่อนอัปเดต
            this.db.ref('inventory_data').orderByChild('code').equalTo(item.code).once('value', snapshot => {
                if(snapshot.exists()){
                    let fbKey = Object.keys(snapshot.val())[0];
                    this.db.ref(`inventory_data/${fbKey}`).update({ main_stock: nMain, sub_stock: nSub }).then(() => {
                        let logId = "HIST-" + new Date().getTime();
                        let now = new Date().toLocaleDateString('en-GB') + " " + new Date().toLocaleTimeString('en-GB');
                        let log = { id: logId, date: now, code: item.code, name: item.name, action: actText, qty: qty, unit: item.unit, main_bal: nMain, sub_bal: nSub, user: this.currentUser, raw_action: action, module: fromModule };
                        
                        // 🌟 แก้ไข: ยิง Push ข้อมูลใหม่เข้าประวัติแบบปลอดภัย 100% ป้องกันข้อมูลทับกัน
                        this.db.ref(`history_data/${logId}`).set(log).then(() => {
                            Swal.fire({title: 'บันทึกสำเร็จ!', icon: 'success', timer: 1500, showConfirmButton: false});
                        });
                    }).catch(e => Swal.fire('Error', e.message, 'error'));
                }
            });
        } else { Swal.fire('ข้อผิดพลาด', 'ต้องต่ออินเทอร์เน็ตเพื่อบันทึกข้อมูล', 'error'); }
    },

    saveBulkAudit: function() {
        Swal.fire({
            title: 'ยืนยันบันทึกยอดตรวจนับ?', text: "ระบบจะอัปเดตสต๊อกให้ตรงกับที่คุณพิมพ์", icon: 'warning',
            showCancelButton: true, confirmButtonText: 'บันทึกทั้งหมด', confirmButtonColor: '#2ecc71'
        }).then((res) => {
            if (res.isConfirmed) {
                let count = 0;
                let now = new Date().toLocaleDateString('en-GB') + " " + new Date().toLocaleTimeString('en-GB');
                
                Swal.fire({title: 'กำลังตรวจสอบและบันทึก...', didOpen: () => Swal.showLoading()});

                // ตรวจสอบทีละรายการผ่าน Firebase ทีละตัวเพื่อความชัวร์ที่สุด
                this.db.ref('inventory_data').once('value', snapshot => {
                    let dbItems = snapshot.val() || {};
                    let updates = {};
                    let logs = {};

                    (this.allItems || []).forEach((item, idx) => {
                        if (!item) return;
                        let mInput = document.getElementById(`audit-m-${idx}`);
                        let sInput = document.getElementById(`audit-s-${idx}`);
                        if (!mInput || !sInput) return;

                        let nMain = parseInt(mInput.value) || 0;
                        let nSub = parseInt(sInput.value) || 0;
                        let oMain = parseInt(item.main_stock || 0);
                        let oSub = parseInt(item.sub_stock || 0);

                        if (nMain !== oMain || nSub !== oSub) {
                            // หา Key ที่ตรงกันในฐานข้อมูล
                            let fbKey = Object.keys(dbItems).find(k => dbItems[k] && dbItems[k].code === item.code);
                            if(fbKey) {
                                updates[`inventory_data/${fbKey}/main_stock`] = nMain;
                                updates[`inventory_data/${fbKey}/sub_stock`] = nSub;
                                
                                let logId = "HIST-" + new Date().getTime() + "-" + count;
                                logs[`history_data/${logId}`] = { id: logId, date: now, code: item.code, name: item.name, action: "ปรับยอด (Spot Audit) 📋", qty: 0, unit: item.unit, main_bal: nMain, sub_bal: nSub, user: this.currentUser, raw_action: 'audit' };
                                count++;
                            }
                        }
                    });

                    if (count === 0) return Swal.fire('ไม่มีการเปลี่ยนแปลง', 'ยอดตรงกับระบบอยู่แล้ว', 'info');

                    // อัปเดตตู้มเดียวรวด
                    this.db.ref().update({...updates, ...logs}).then(() => {
                        Swal.fire('สำเร็จ!', `ปรับยอดใหม่ ${count} รายการ`, 'success');
                    });
                });
            }
        });
    }
};

// ==========================================
// 🎨 UI Rendering Logic
// ==========================================
const UI = {
    currentTabId: 'view-dashboard',

    setSyncStatus: function(text, color, icon) {
        const el = document.getElementById('syncStatus');
        if (!el) return;
        el.className = `badge bg-${color} me-2`;
        el.innerHTML = `<i class="fas fa-${icon} me-1"></i> ${text}`;
    },

    switchTab: function(tabId, element) {
        document.querySelectorAll('.main-content').forEach(el => el.classList.remove('active'));
        const targetView = document.getElementById(tabId);
        if (targetView) targetView.classList.add('active');
        
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
        try {
            const searchInput = document.getElementById('searchDashboard');
            const term = searchInput ? String(searchInput.value).toLowerCase() : '';
            
            const cardCont = document.getElementById('dashboardCardContainer');
            const tableCont = document.getElementById('dashboardTableBody');
            const printCont = document.getElementById('dashboardTableBodyPrint');
            
            let cardHtml = ''; let tableHtml = ''; let printHtml = '';

            let items = AppCore.allItems;

            let hasData = false;
            items.forEach((i, idx) => {
                let itemName = String(i.name || "");
                let itemCode = String(i.code || "");
                let itemCat = String(i.category || "");

                if (term && !itemName.toLowerCase().includes(term) && !itemCode.toLowerCase().includes(term) && !itemCat.toLowerCase().includes(term)) return;
                hasData = true;

                let main = parseInt(i.main_stock || 0), sub = parseInt(i.sub_stock || 0), total = main + sub;
                let mColor = main > 10 ? 'success' : (main > 0 ? 'warning' : 'danger');

                cardHtml += `
                <div class="col-12 col-sm-6">
                    <div class="item-card" onclick="UI.showActionMenu(${idx})">
                        <div style="flex:1;">
                            <span class="badge bg-secondary mb-1">${i.seq_num||'-'} | ${itemCode || '-'}</span>
                            <div class="fw-bold text-dark lh-sm mb-1">${itemName}</div>
                            <div class="text-muted" style="font-size:0.8rem;">${itemCat || '-'}</div>
                        </div>
                        <div class="text-end ms-2">
                            <div class="fs-4 fw-bold text-${mColor}">${main} <span class="fs-6 text-muted">${i.unit || 'ชิ้น'}</span></div>
                            <div style="font-size:0.8rem; color:#e74c3c;">ย่อย: ${sub}</div>
                        </div>
                    </div>
                </div>`;

                tableHtml += `
                <tr style="cursor:pointer;" onclick="UI.showActionMenu(${idx})">
                    <td class="text-center text-secondary">${itemCode || '-'}</td>
                    <td><b class="text-dark">${itemName}</b><br><small class="text-muted">${itemCat || '-'}</small></td>
                    <td class="text-center text-${mColor} fw-bold fs-5">${main}</td>
                    <td class="text-center text-danger fw-bold fs-5">${sub}</td>
                    <td class="text-center text-primary fw-bold fs-5">${total}</td>
                    <td class="text-center print-hide"><button class="btn btn-sm btn-outline-primary"><i class="fas fa-bolt"></i> จัดการ</button></td>
                </tr>`;

                printHtml += `
                <tr>
                    <td class="text-center">${itemCode || '-'}</td>
                    <td><b>${itemName}</b><br><small>${itemCat || '-'}</small></td>
                    <td class="text-center fw-bold">${main}</td>
                    <td class="text-center fw-bold">${sub}</td>
                    <td class="text-center fw-bold">${total}</td>
                </tr>`;
            });

            if(!hasData) {
                cardHtml = `<div class="text-center py-4 text-muted w-100">ไม่พบข้อมูลพัสดุ</div>`;
                tableHtml = `<tr><td colspan="6" class="text-center py-4 text-muted">ไม่พบข้อมูลพัสดุ</td></tr>`;
                printHtml = `<tr><td colspan="5" class="text-center py-4 text-muted">ไม่พบข้อมูลพัสดุ</td></tr>`;
            }

            if (cardCont) cardCont.innerHTML = cardHtml;
            if (tableCont) tableCont.innerHTML = tableHtml;
            if (printCont) printCont.innerHTML = printHtml;
        } catch (e) { console.error("Dashboard Error: ", e); }
    },

    // 🛏️ 2. คิวคนไข้ (Visits)
    renderVisits: function() {
        try {
            const searchInput = document.getElementById('searchVisits');
            const term = searchInput ? String(searchInput.value).toLowerCase() : '';

            const cont = document.getElementById('visitListContainer');
            const printTable = document.getElementById('visitTableBodyPrint');
            
            let today = new Date();
            let todayStr = `${String(today.getDate()).padStart(2,'0')}/${String(today.getMonth()+1).padStart(2,'0')}/${today.getFullYear()+543}`;
            
            const badgeElem = document.getElementById('visitDateBadge');
            if (badgeElem) badgeElem.innerText = todayStr;

            let todayVisits = (AppCore.visitsData || []).filter(v => v && v.date && String(v.date).split(" ")[0] === todayStr);

            let cardHtml = ''; let printHtml = ''; let hasData = false;

            todayVisits.forEach((v) => {
                let vName = String(v.name || "").toLowerCase();
                let vHn = String(v.hn || "").toLowerCase();
                
                if (term && !vName.includes(term) && !vHn.includes(term)) return;
                hasData = true;

                let statusStr = String(v.status || "รอตรวจ");
                let sColor = statusStr.includes("กำลังฟอก") ? "primary" : (statusStr.includes("เสร็จ") ? "success" : "warning");
                
                cardHtml += `
                <div class="col-12 col-md-6 col-lg-4">
                    <div class="modern-card border-top border-${sColor} border-4">
                        <div class="d-flex justify-content-between mb-2">
                            <span class="badge bg-${sColor}">${statusStr}</span>
                            <span class="text-muted fw-bold"><i class="fas fa-clock"></i> ${v.time || '-'}</span>
                        </div>
                        <h5 class="fw-bold mb-1">${v.name || '-'}</h5>
                        <div class="text-muted fs-6 mb-3">HN: ${v.hn || '-'} | เตียง: ${v.bed || '-'}</div>
                        <div class="bg-light p-2 rounded mb-3" style="font-size:0.85rem;">
                            <div><b>ยาที่ใช้:</b> <span class="text-danger">${v.meds || '-'}</span></div>
                            <div><b>น้ำเกลือ:</b> <span class="text-info">${v.saline || '-'}</span></div>
                        </div>
                        <button class="btn btn-outline-primary w-100 fw-bold print-hide" onclick="UI.openDispenseModal('${v.hn}', '${v.name}')">
                            <i class="fas fa-box-open me-2"></i> สแกนจ่ายยา / เวชภัณฑ์
                        </button>
                    </div>
                </div>`;
                
                printHtml += `
                <tr>
                    <td class="text-center">${v.time || '-'}</td>
                    <td class="text-center fw-bold">${v.hn || '-'}</td>
                    <td class="fw-bold">${v.name || '-'}</td>
                    <td class="text-center text-primary fw-bold">${v.bed || '-'}</td>
                    <td class="text-center">${v.right || '-'}</td>
                    <td><small>ยา: ${v.meds || '-'}<br>น้ำเกลือ: ${v.saline || '-'}</small></td>
                    <td class="text-center fw-bold text-${sColor}">${statusStr}</td>
                </tr>`;
            });

            if (!hasData) {
                if (cont) cont.innerHTML = '<div class="text-center text-muted py-5 w-100"><i class="fas fa-search fa-3x mb-3"></i><br>ไม่พบข้อมูลคิว หรือไม่มีคิววันนี้</div>';
                if (printTable) printTable.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">ไม่มีคิวฟอกไตสำหรับวันนี้</td></tr>';
            } else {
                if (cont) cont.innerHTML = cardHtml;
                if (printTable) printTable.innerHTML = printHtml;
            }
        } catch(e) { console.error("Visits Error: ", e); }
    },

    openDispenseModal: function(hn, name) {
        Swal.fire({
            title: 'เตรียมสแกนจ่ายพัสดุ',
            html: `ระบบพร้อมสแกนจ่ายพัสดุให้คนไข้:<br><b class="text-primary fs-4">${name}</b>`,
            icon: 'info', timer: 1500, showConfirmButton: false
        }).then(() => {
            AppCore.scanContext = { mode: 'dispense', hn: hn, name: name };
            setTimeout(() => AppCore.toggleUniversalScanner(), 300);
        });
    },

    // 📋 3. ตรวจนับสต๊อก (Audit)
    renderAudit: function() {
        try {
            const searchInput = document.getElementById('searchAudit');
            const term = searchInput ? String(searchInput.value).toLowerCase() : '';

            const cont = document.getElementById('auditListContainer');
            const printTable = document.getElementById('auditTableBodyPrint');
            
            let cardHtml = ''; let printHtml = ''; let hasData = false;
            
            let items = AppCore.allItems;

            items.forEach((i, idx) => {
                let itemName = String(i.name || "");
                let itemCode = String(i.code || "");

                if (term && !itemName.toLowerCase().includes(term) && !itemCode.toLowerCase().includes(term)) return;
                hasData = true;

                let mStock = parseInt(i.main_stock)||0;
                let sStock = parseInt(i.sub_stock)||0;
                let totalSystem = mStock + sStock;
                
                cardHtml += `
                <div class="col-12 col-md-6" id="audit-card-${idx}">
                    <div class="item-card flex-column align-items-start border-secondary" style="transition: all 0.3s ease;">
                        <div class="fw-bold mb-2 text-dark w-100 d-flex justify-content-between">
                            <span>${i.seq_num||'-'}. ${i.name || '-'}</span>
                            <span class="badge bg-info" id="audit-badge-${idx}">ในระบบ: ${totalSystem}</span>
                        </div>
                        <div class="d-flex w-100 gap-2">
                            <div class="flex-fill">
                                <label class="text-muted" style="font-size:0.8rem;">หลัก</label>
                                <div class="input-group input-group-sm">
                                    <input type="number" id="audit-m-${idx}" class="form-control text-center fw-bold" value="${mStock}" onclick="this.select()" onchange="UI.updateAuditTotal(${idx})" onkeyup="UI.updateAuditTotal(${idx})">
                                    <button class="btn btn-secondary px-2 print-hide" onclick="AppCore.openCalculator('audit-m-${idx}', document.getElementById('audit-m-${idx}').value)"><i class="fas fa-calculator"></i></button>
                                </div>
                            </div>
                            <div class="flex-fill">
                                <label class="text-danger" style="font-size:0.8rem;">ย่อย</label>
                                <div class="input-group input-group-sm">
                                    <input type="number" id="audit-s-${idx}" class="form-control text-center text-danger fw-bold border-danger" value="${sStock}" onclick="this.select()" onchange="UI.updateAuditTotal(${idx})" onkeyup="UI.updateAuditTotal(${idx})">
                                    <button class="btn btn-danger px-2 print-hide" onclick="AppCore.openCalculator('audit-s-${idx}', document.getElementById('audit-s-${idx}').value)"><i class="fas fa-calculator"></i></button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>`;
                
                printHtml += `
                <tr>
                    <td class="text-center">${i.seq_num || '-'}</td>
                    <td class="text-center">${i.code || '-'}</td>
                    <td class="fw-bold">${i.name || '-'}</td>
                    <td class="text-center text-primary fw-bold fs-5">${totalSystem}</td>
                    <td class="text-center fw-bold">${mStock}</td>
                    <td class="text-center fw-bold text-danger">${sStock}</td>
                    <td></td>
                </tr>`;
            });

            if(!hasData){
                cardHtml = `<div class="text-center py-4 text-muted w-100">ไม่พบพัสดุที่ค้นหา</div>`;
            }

            if (cont) cont.innerHTML = cardHtml;
            if (printTable) printTable.innerHTML = printHtml;
        } catch(e) { console.error("Audit Error: ", e); }
    },

    updateAuditTotal: function(idx) {
        let mElem = document.getElementById(`audit-m-${idx}`);
        let sElem = document.getElementById(`audit-s-${idx}`);
        let m = mElem ? (parseInt(mElem.value) || 0) : 0;
        let s = sElem ? (parseInt(sElem.value) || 0) : 0;
        
        let badge = document.getElementById(`audit-badge-${idx}`);
        if(badge) {
            badge.innerText = "กำลังนับ... (" + (m + s) + ")";
            badge.className = "badge bg-warning text-dark"; // เปลี่ยนสีเวลาโดนพิมพ์เปลี่ยนค่า
        }
    },

    // 🌟 3.1 ฟังก์ชันใหม่: ป๊อปอัปให้พิมพ์เลขตรวจนับทันทีหลังสแกน 🌟
    showAuditQuickInput: function(idx) {
        const item = AppCore.allItems[idx];
        if(!item) return;
        
        let mElem = document.getElementById(`audit-m-${idx}`);
        let sElem = document.getElementById(`audit-s-${idx}`);
        let currentM = mElem ? mElem.value : (item.main_stock || 0);
        let currentS = sElem ? sElem.value : (item.sub_stock || 0);

        Swal.fire({
            title: '📋 ตรวจนับสต๊อก (ด่วน)',
            html: `
                <div class="text-start">
                    <span class="badge bg-secondary mb-2">${item.code || '-'}</span>
                    <h5 class="fw-bold text-primary mb-3">${item.name}</h5>
                    <div class="d-flex w-100 gap-2 mb-3">
                        <div class="flex-fill">
                            <label class="text-muted fw-bold" style="font-size: 0.85rem;">คลังหลัก (ระบบมี: ${item.main_stock||0})</label>
                            <div class="input-group">
                                <input type="number" id="quick-audit-m" class="form-control form-control-lg text-center fw-bold border-secondary" value="${currentM}" onclick="this.select()">
                                <button class="btn btn-secondary px-3" onclick="AppCore.openCalculator('quick-audit-m', document.getElementById('quick-audit-m').value)"><i class="fas fa-calculator"></i></button>
                            </div>
                        </div>
                    </div>
                    <div class="d-flex w-100 gap-2 mb-2">
                        <div class="flex-fill">
                            <label class="text-danger fw-bold" style="font-size: 0.85rem;">คลังย่อย (ระบบมี: ${item.sub_stock||0})</label>
                            <div class="input-group">
                                <input type="number" id="quick-audit-s" class="form-control form-control-lg text-center text-danger border-danger fw-bold" value="${currentS}" onclick="this.select()">
                                <button class="btn btn-danger px-3" onclick="AppCore.openCalculator('quick-audit-s', document.getElementById('quick-audit-s').value)"><i class="fas fa-calculator"></i></button>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: '<i class="fas fa-check"></i> อัปเดตลงตาราง',
            cancelButtonText: 'ปิดหน้าต่าง',
            confirmButtonColor: '#2ecc71',
            preConfirm: () => {
                let newM = document.getElementById('quick-audit-m').value;
                let newS = document.getElementById('quick-audit-s').value;
                return { m: parseInt(newM)||0, s: parseInt(newS)||0 };
            }
        }).then((result) => {
            if (result.isConfirmed) {
                // เอาตัวเลขไปยัดใส่กล่องในตาราง
                if(mElem) mElem.value = result.value.m;
                if(sElem) sElem.value = result.value.s;
                UI.updateAuditTotal(idx);
                
                // ไฮไลต์บอกผู้ใช้ว่าอัปเดตช่องนี้แล้วนะ
                let cardDiv = document.getElementById(`audit-card-${idx}`);
                if(cardDiv) {
                    // เลื่อนหน้าจอให้เห็นการ์ดนี้แบบสมูท
                    cardDiv.scrollIntoView({behavior: 'smooth', block: 'center'});
                    let innerCard = cardDiv.querySelector('.item-card');
                    if (innerCard) {
                        innerCard.style.backgroundColor = '#d4edda'; // สีเขียวอ่อน
                        innerCard.style.border = '2px solid #28a745';
                        setTimeout(() => { 
                            innerCard.style.backgroundColor = 'white'; 
                            innerCard.style.border = '';
                        }, 2000);
                    }
                }
                
                Swal.fire({
                    toast: true, position: 'top', icon: 'success', 
                    title: 'อัปเดตยอดลงในตาราง (อย่าลืมกดปุ่มบันทึกทั้งหมดเมื่อนับเสร็จ!)', 
                    showConfirmButton: false, timer: 3000
                });
            }
        });
    },

    // 📜 4. ประวัติ (History)
    renderHistory: function() {
        try {
            const searchInput = document.getElementById('searchHistory');
            const term = searchInput ? String(searchInput.value).toLowerCase() : '';

            const cont = document.getElementById('historyListContainer');
            const printTable = document.getElementById('historyTableBodyPrint');
            let cardHtml = ''; let printHtml = ''; let hasData = false;
            
            if (!AppCore.historyData || AppCore.historyData.length === 0) {
                if (cont) cont.innerHTML = '<div class="text-center text-muted py-4 w-100">ไม่มีประวัติทำรายการ</div>';
                if (printTable) printTable.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">ไม่มีประวัติทำรายการ</td></tr>';
                return;
            }

            AppCore.historyData.forEach(log => {
                let itemName = String(log.name || "").toLowerCase();
                let user = String(log.user || "").toLowerCase();
                let action = String(log.action || "").toLowerCase();
                let code = String(log.code || "").toLowerCase(); // ให้ค้นหาด้วยบาร์โค้ดได้ด้วย

                if (term && !itemName.includes(term) && !user.includes(term) && !action.includes(term) && !code.includes(term)) return;
                hasData = true;

                let actionStr = String(log.action || "");
                let aColor = "secondary";
                if (actionStr.includes("รับเข้า")) aColor = "success";
                else if (actionStr.includes("ใช้งาน")) aColor = "warning";
                else if (actionStr.includes("โอน") || actionStr.includes("คืนเข้า")) aColor = "primary";

                let totalBal = (parseInt(log.main_bal) || 0) + (parseInt(log.sub_bal) || 0);

                cardHtml += `
                <div class="col-12">
                    <div class="bg-white p-3 rounded mb-2 shadow-sm border-start border-4 border-${aColor}">
                        <div class="d-flex justify-content-between mb-1">
                            <span class="badge bg-light text-dark border">${log.date || '-'}</span>
                            <span class="text-${aColor} fw-bold"><i class="fas fa-caret-right"></i> ${actionStr}</span>
                        </div>
                        <div class="fw-bold text-dark">${log.name || '-'}</div>
                        <div class="d-flex justify-content-between align-items-center mt-2">
                            <span class="fs-5 fw-bold ${aColor === 'warning' ? 'text-danger' : 'text-dark'}">${log.qty > 0 ? log.qty + ' ' + (log.unit || '') : ''}</span>
                            <span class="text-muted" style="font-size:0.8rem;">ผู้ทำ: ${log.user || '-'}</span>
                        </div>
                    </div>
                </div>`;
                
                printHtml += `
                <tr>
                    <td class="text-center"><small>${log.date || '-'}</small></td>
                    <td class="text-center">${log.code || '-'}</td>
                    <td class="fw-bold">${log.name || '-'}</td>
                    <td class="text-center text-${aColor} fw-bold">${actionStr}</td>
                    <td class="text-center fw-bold fs-5">${log.qty > 0 ? log.qty : '-'}</td>
                    <td class="text-center text-primary fw-bold fs-5">${totalBal}</td>
                    <td class="text-center"><small>${log.user || '-'}</small></td>
                </tr>`;
            });

            if(!hasData) {
                cardHtml = `<div class="text-center py-4 text-muted w-100">ไม่พบประวัติที่ค้นหา</div>`;
            }

            if (cont) cont.innerHTML = cardHtml;
            if (printTable) printTable.innerHTML = printHtml;
        } catch(e) { console.error("History Error: ", e); }
    },

    // 🧰 เมนูจัดการเมื่อคลิกพัสดุ (ของหน้าคลังหลัก)
    showActionMenu: function(idx, customTitle = null) {
        const item = AppCore.allItems[idx];
        if (!item) return;

        let titleHtml = customTitle ? `<h6 class="text-danger fw-bold mb-2"><i class="fas fa-user"></i> ${customTitle}</h6>` : '';

        Swal.fire({
            html: `
                <div class="text-start">
                    ${titleHtml}
                    <span class="badge bg-secondary mb-2">${item.code || '-'}</span>
                    <h5 class="fw-bold text-primary mb-3">${item.name}</h5>
                    <div class="d-flex justify-content-around p-2 bg-light rounded mb-3 border">
                        <div class="text-center">สต๊อกหลัก<br><b class="fs-3 text-dark">${item.main_stock||0}</b></div>
                        <div class="text-center">สต๊อกย่อย<br><b class="fs-3 text-danger">${item.sub_stock||0}</b></div>
                    </div>
                    
                    <label class="fw-bold mb-1 text-secondary">ระบุจำนวนที่ต้องการทำรายการ:</label>
                    <div class="input-group mb-4 shadow-sm">
                        <input type="number" id="quickQty" class="form-control form-control-lg text-center fw-bold text-primary border-primary" value="1" onclick="this.select()">
                        <button class="btn btn-primary px-3" onclick="AppCore.openCalculator('quickQty', document.getElementById('quickQty').value)"><i class="fas fa-calculator"></i></button>
                    </div>
                    
                    <div class="d-grid gap-2">
                        <button class="btn btn-warning py-3 fw-bold shadow-sm" onclick="UI.executeAction(${idx}, 'use')"><i class="fas fa-upload me-2"></i> ตัดสต๊อก (เบิกใช้งาน)</button>
                        
                        <div class="d-flex gap-2">
                            <button class="btn btn-primary py-3 fw-bold text-white shadow-sm w-50" onclick="UI.executeAction(${idx}, 'transfer')"><i class="fas fa-arrow-right me-1"></i> โอนไปย่อย</button>
                            <button class="btn btn-info py-3 fw-bold text-white shadow-sm w-50" onclick="UI.executeAction(${idx}, 'transfer_back')"><i class="fas fa-undo me-1"></i> คืนเข้าหลัก</button>
                        </div>
                        
                        <button class="btn btn-success py-3 fw-bold shadow-sm" onclick="UI.executeAction(${idx}, 'receive_main')"><i class="fas fa-download me-2"></i> รับของเข้า (คลังหลัก)</button>
                        <button class="btn btn-outline-secondary py-2 mt-2 fw-bold" onclick="AppCore.editItemForm(${idx})"><i class="fas fa-edit me-2"></i> แก้ไขรายละเอียดพัสดุ</button>
                    </div>
                </div>
            `,
            showConfirmButton: false, showCancelButton: true, cancelButtonText: 'ปิดหน้าต่าง'
        });
    },

    executeAction: function(idx, action) {
        const qtyElem = document.getElementById('quickQty');
        let qty = qtyElem ? parseInt(qtyElem.value) : 0;
        
        if(!qty || qty <= 0) return Swal.showValidationMessage('ใส่จำนวนที่ถูกต้อง');
        Swal.close();
        AppCore.processTransaction(idx, action, qty);
    }
};

document.addEventListener("DOMContentLoaded", () => AppCore.init());