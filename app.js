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

    // 🚪 ระบบออกจากระบบ
    logoutApp: function() {
        Swal.fire({
            title: 'ออกจากระบบ?',
            text: "คุณต้องการออกจากระบบคลังพัสดุใช่หรือไม่?",
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'ออกจากระบบ',
            cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#e74c3c'
        }).then((result) => {
            if (result.isConfirmed) {
                window.location.replace("scanner_login.html?v=" + new Date().getTime());
            }
        });
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
                if(res.isConfirmed) this.showAddItemForm(code);
            });
        }
    },

    // =========================================
    // ➕ ระบบลงทะเบียนและแก้ไขพัสดุ (Full Form)
    // =========================================
    getCategoryOptionsHTML: function() {
        let cats = new Set(["เวชภัณฑ์ทางการแพทย์", "อุปกรณ์สำนักงาน", "น้ำยา/อุปกรณ์ทำความสะอาด", "น้ำยาไต (ทั่วไป)", "อื่นๆ"]);
        this.allItems.forEach(item => { 
            if(item && item.category && item.category.length < 40) cats.add(item.category);
        });
        return Array.from(cats).map(cat => `<option value="${cat}">`).join('');
    },

    generateRandomCodePopup: function(inputId) {
        const prefix = "ITM-"; 
        const randomNum = Math.floor(1000 + Math.random() * 9000); 
        document.getElementById(inputId).value = prefix + randomNum;
    },

    startPopupScanner: function(readerId, inputId) {
        const readerDiv = document.getElementById(readerId);
        readerDiv.style.display = 'block';
        if (this.popupScannerInst) this.popupScannerInst.clear();
        this.popupScannerInst = new Html5QrcodeScanner(readerId, { fps: 10, qrbox: { width: 220, height: 220 } }, false);
        this.popupScannerInst.render((decodedText) => {
            document.getElementById(inputId).value = decodedText;
            this.popupScannerInst.clear();
            readerDiv.style.display = 'none';
            try { document.getElementById('soundScan').play(); } catch(e) {}
        }, (error) => {});
    },

    showAddItemForm: function(scannedCode = "") {
        let defaultSeq = this.allItems.length + 1;
        Swal.fire({
            title: '➕ เพิ่มทะเบียนพัสดุใหม่', 
            width: '600px',
            html: `
                <div class="text-start mt-3" style="font-family: 'Sarabun', sans-serif; font-size: 0.9rem;">
                    <div class="row">
                        <div class="col-4 mb-3"><label class="form-label fw-bold">ลำดับ</label><input id="swal-seq" class="form-control" value="${defaultSeq}"></div>
                        <div class="col-8 mb-3">
                            <label class="form-label fw-bold text-primary">หมวดหมู่</label>
                            <input type="text" id="swal-cat" list="catList" class="form-control border-primary" placeholder="พิมพ์ใหม่ หรือเลือก...">
                            <datalist id="catList">${this.getCategoryOptionsHTML()}</datalist>
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <label class="form-label fw-bold">รหัสพัสดุ (Code)</label>
                            <div class="input-group">
                                <input id="swal-code" class="form-control" placeholder="เช่น A01" value="${scannedCode}">
                                <button type="button" class="btn btn-warning text-dark px-2" onclick="AppCore.generateRandomCodePopup('swal-code')" title="สุ่มรหัส"><i class="fas fa-dice"></i></button>
                                <button type="button" class="btn btn-info text-white px-2" onclick="AppCore.startPopupScanner('readerPopup', 'swal-code')" title="สแกน"><i class="fas fa-camera"></i></button>
                            </div>
                            <div id="readerPopup" style="display: none; width: 100%; margin-top: 8px; border-radius: 8px; overflow: hidden; border: 2px solid #17a2b8;"></div>
                        </div>
                        <div class="col-md-6 mb-3"><label class="form-label fw-bold">ชื่อพัสดุ / อุปกรณ์</label><input id="swal-name" class="form-control" placeholder="ระบุชื่อพัสดุ"></div>
                    </div>
                    <div class="row">
                        <div class="col-md-4 mb-3"><label class="form-label fw-bold">หน่วยนับ</label><input id="swal-unit" class="form-control" placeholder="เช่น ชิ้น, กล่อง"></div>
                        <div class="col-md-4 mb-3"><label class="form-label fw-bold">บรรจุ/กล่อง</label><input type="number" id="swal-per-box" class="form-control" value="1"></div>
                        <div class="col-md-4 mb-3"><label class="form-label fw-bold">ราคา (บาท)</label><input type="number" id="swal-price" class="form-control" value="0"></div>
                    </div>
                    <div class="row bg-light p-2 rounded mx-0 mt-2">
                        <div class="col-4 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.8rem;">ใช้เฉลี่ย/ด.</label><input type="number" id="swal-usage" class="form-control text-center" value="0"></div>
                        <div class="col-4 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.8rem;">ยอดตั้งต้น</label><input type="number" id="swal-target" class="form-control text-center" value="0"></div>
                        <div class="col-4 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.8rem;">แจ้งเตือนต่ำกว่า</label><input type="number" id="swal-min" class="form-control text-center" value="10"></div>
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
                if (this.allItems.some(i => i && i.code === res.value.code)) return Swal.fire('ผิดพลาด', 'รหัสบาร์โค้ดนี้มีในระบบแล้ว!', 'error');
                
                let newItem = { id: "ITM" + new Date().getTime(), ...res.value, main_stock: 0, sub_stock: 0, req_qty: "", req_note: "" };
                if (this.db && document.getElementById('syncStatus').innerText.includes('ออนไลน์')) {
                    this.db.ref(`inventory_data/${this.allItems.length}`).set(newItem).then(() => {
                        Swal.fire('สำเร็จ', 'บันทึกพัสดุใหม่ขึ้นระบบออนไลน์แล้ว', 'success');
                    });
                } else { Swal.fire('ข้อผิดพลาด', 'ไม่สามารถบันทึกได้ กรุณาตรวจสอบอินเทอร์เน็ต', 'error'); }
            }
        });
    },

    editItemForm: function(idx) {
        const item = this.allItems[idx];
        Swal.fire({
            title: '📝 แก้ไขข้อมูลพัสดุ', width: '600px',
            html: `
                <div class="text-start mt-3" style="font-family: 'Sarabun', sans-serif; font-size: 0.9rem;">
                    <div class="row">
                        <div class="col-4 mb-3"><label class="form-label fw-bold">ลำดับ</label><input id="edit-seq" class="form-control" value="${item.seq_num || ''}"></div>
                        <div class="col-8 mb-3">
                            <label class="form-label fw-bold text-primary">หมวดหมู่</label>
                            <input type="text" id="edit-cat" list="catListEdit" class="form-control border-primary" value="${item.category || ''}">
                            <datalist id="catListEdit">${this.getCategoryOptionsHTML()}</datalist>
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <label class="form-label fw-bold">รหัสพัสดุ (Code)</label>
                            <div class="input-group">
                                <input id="edit-code" class="form-control" value="${item.code || ''}">
                                <button type="button" class="btn btn-warning text-dark px-2" onclick="AppCore.generateRandomCodePopup('edit-code')"><i class="fas fa-dice"></i></button>
                                <button type="button" class="btn btn-info text-white px-2" onclick="AppCore.startPopupScanner('readerPopupEdit', 'edit-code')"><i class="fas fa-camera"></i></button>
                            </div>
                            <div id="readerPopupEdit" style="display: none; width: 100%; margin-top: 8px; border-radius: 8px; border: 2px solid #17a2b8;"></div>
                        </div>
                        <div class="col-md-6 mb-3"><label class="form-label fw-bold">ชื่อพัสดุ / อุปกรณ์</label><input id="edit-name" class="form-control" value="${item.name || ''}"></div>
                    </div>
                    <div class="row">
                        <div class="col-md-4 mb-3"><label class="form-label fw-bold">หน่วยนับ</label><input id="edit-unit" class="form-control" value="${item.unit || 'ชิ้น'}"></div>
                        <div class="col-md-4 mb-3"><label class="form-label fw-bold">บรรจุ/กล่อง</label><input type="number" id="edit-per-box" class="form-control" value="${item.qty_per_box || ''}"></div>
                        <div class="col-md-4 mb-3"><label class="form-label fw-bold">ราคา (บาท)</label><input type="number" id="edit-price" class="form-control" value="${item.price || ''}"></div>
                    </div>
                    <div class="row bg-light p-2 rounded mx-0 mt-2">
                        <div class="col-4 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.8rem;">ใช้เฉลี่ย/ด.</label><input type="number" id="edit-usage" class="form-control text-center" value="${item.monthly_usage || ''}"></div>
                        <div class="col-4 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.8rem;">ยอดตั้งต้น</label><input type="number" id="edit-target" class="form-control text-center" value="${item.target_stock || ''}"></div>
                        <div class="col-4 px-1"><label class="form-label fw-bold text-secondary" style="font-size: 0.8rem;">แจ้งเตือนต่ำกว่า</label><input type="number" id="edit-min" class="form-control text-center" value="${item.min_alert || ''}"></div>
                    </div>
                </div>
            `,
            showCancelButton: true, confirmButtonText: '<i class="fas fa-save"></i> บันทึกการแก้ไข', confirmButtonColor: '#3498db', cancelButtonText: 'ยกเลิก',
            preConfirm: () => { 
                return { 
                    seq_num: document.getElementById('edit-seq').value.trim(), 
                    code: document.getElementById('edit-code').value.trim(), 
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
                if(!res.value.name || !res.value.code) return Swal.fire('ผิดพลาด', 'กรุณากรอกรหัสและชื่อให้ครบ', 'warning');
                if (this.db && document.getElementById('syncStatus').innerText.includes('ออนไลน์')) {
                    this.db.ref(`inventory_data/${idx}`).update(res.value).then(() => {
                        Swal.fire('สำเร็จ', 'แก้ไขพัสดุเรียบร้อย', 'success');
                    });
                }
            }
        });
    },

    // 🧮 ระบบเครื่องคิดเลข
    openCalculator: function(targetId, currentValue) {
        this.currentCalcTargetId = targetId;
        document.getElementById('calcDisplay').value = currentValue || '';
        new bootstrap.Modal(document.getElementById('calculatorModal')).show();
    },
    calcAppend: function(val) { 
        const display = document.getElementById('calcDisplay');
        display.value += val; 
        display.scrollLeft = display.scrollWidth;
    },
    calcBackspace: function() {
        let display = document.getElementById('calcDisplay');
        display.value = display.value.slice(0, -1);
        display.scrollLeft = display.scrollWidth;
    },
    calcClear: function() { document.getElementById('calcDisplay').value = ''; },
    calcConfirm: function() {
        let expr = document.getElementById('calcDisplay').value;
        let finalVal = 0;
        if(/^[0-9+\-*/.\s]+$/.test(expr)) { 
            try { 
                let res = eval(expr); 
                if(isFinite(res)) finalVal = Math.floor(res); 
            } catch(e) {} 
        }
        if(isNaN(finalVal) || finalVal < 0) finalVal = 0;

        let el = document.getElementById(this.currentCalcTargetId);
        if(el) {
            el.value = finalVal;
            // ถ้ากดใช้ในหน้า Audit ให้บวกยอดรวมเรียลไทม์ด้วย
            if (this.currentCalcTargetId.includes("audit-")) {
                let idxStr = this.currentCalcTargetId.split('-').pop();
                let m = parseInt(document.getElementById(`audit-m-${idxStr}`).value) || 0;
                let s = parseInt(document.getElementById(`audit-s-${idxStr}`).value) || 0;
                let badge = document.getElementById(`audit-badge-${idxStr}`);
                if(badge) badge.innerText = "รวมนับได้: " + (m + s);
            }
        }
        bootstrap.Modal.getInstance(document.getElementById('calculatorModal')).hide();
    },

    // 🌟 ระบบบันทึก 🌟
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

    // 📋 3. ตรวจนับสต๊อก (Audit) - อัปเดตเครื่องคิดเลข
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
                        <span class="badge bg-info" id="audit-badge-${idx}">ในระบบ: ${(parseInt(i.main_stock)||0) + (parseInt(i.sub_stock)||0)}</span>
                    </div>
                    <div class="d-flex w-100 gap-2">
                        <div class="flex-fill">
                            <label class="text-muted" style="font-size:0.8rem;">หลัก</label>
                            <div class="input-group input-group-sm">
                                <input type="number" id="audit-m-${idx}" class="form-control text-center fw-bold" value="${i.main_stock||0}" onclick="this.select()" onchange="UI.updateAuditTotal(${idx})" onkeyup="UI.updateAuditTotal(${idx})">
                                <button class="btn btn-secondary px-2" onclick="AppCore.openCalculator('audit-m-${idx}', document.getElementById('audit-m-${idx}').value)"><i class="fas fa-calculator"></i></button>
                            </div>
                        </div>
                        <div class="flex-fill">
                            <label class="text-danger" style="font-size:0.8rem;">ย่อย</label>
                            <div class="input-group input-group-sm">
                                <input type="number" id="audit-s-${idx}" class="form-control text-center text-danger fw-bold border-danger" value="${i.sub_stock||0}" onclick="this.select()" onchange="UI.updateAuditTotal(${idx})" onkeyup="UI.updateAuditTotal(${idx})">
                                <button class="btn btn-danger px-2" onclick="AppCore.openCalculator('audit-s-${idx}', document.getElementById('audit-s-${idx}').value)"><i class="fas fa-calculator"></i></button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        });
    },

    updateAuditTotal: function(idx) {
        let m = parseInt(document.getElementById(`audit-m-${idx}`).value) || 0;
        let s = parseInt(document.getElementById(`audit-s-${idx}`).value) || 0;
        let badge = document.getElementById(`audit-badge-${idx}`);
        if(badge) badge.innerText = "รวมนับได้: " + (m + s);
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

    // 🧰 เมนูจัดการเมื่อคลิกพัสดุ (พร้อมปุ่มเครื่องคิดเลข และ ปุ่ม Edit)
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
                    <div class="input-group mb-3">
                        <input type="number" id="quickQty" class="form-control form-control-lg text-center fw-bold text-primary border-primary" value="1" onclick="this.select()">
                        <button class="btn btn-primary px-3" onclick="AppCore.openCalculator('quickQty', document.getElementById('quickQty').value)"><i class="fas fa-calculator"></i></button>
                    </div>
                    
                    <div class="d-grid gap-2">
                        <button class="btn btn-warning py-3 fw-bold" onclick="UI.executeAction(${idx}, 'use')"><i class="fas fa-upload me-2"></i> ตัดสต๊อก (ใช้งาน)</button>
                        <button class="btn btn-primary py-3 fw-bold text-white" onclick="UI.executeAction(${idx}, 'transfer')"><i class="fas fa-exchange-alt me-2"></i> โอน (หลัก ➡️ ย่อย)</button>
                        <button class="btn btn-success py-3 fw-bold" onclick="UI.executeAction(${idx}, 'receive_main')"><i class="fas fa-download me-2"></i> รับของเข้า (คลังหลัก)</button>
                        <button class="btn btn-outline-secondary py-2 mt-2 fw-bold" onclick="AppCore.editItemForm(${idx})"><i class="fas fa-edit me-2"></i> แก้ไขรายละเอียดพัสดุ</button>
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
    }
};

// เริ่มต้นระบบเมื่อโหลดหน้าเว็บเสร็จ
document.addEventListener("DOMContentLoaded", () => AppCore.init());