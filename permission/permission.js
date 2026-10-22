// Grants the extension origin microphone access. The offscreen document that
// records audio can't show this prompt itself, so the popup opens this tab once.
const msg = document.getElementById('msg');

navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    stream.getTracks().forEach(t => t.stop());
    msg.className = 'ok';
    msg.textContent = 'Đã cấp quyền micro. Tab này sẽ tự đóng, hãy mở extension và bấm Bắt đầu. / Microphone allowed. This tab will close; open the extension and press Start.';
    setTimeout(() => window.close(), 2500);
}).catch(err => {
    msg.className = 'err';
    msg.textContent = 'Không có quyền micro (' + err.name + '). Bấm biểu tượng ổ khóa/camera trên thanh địa chỉ để cho phép, rồi tải lại trang. / Microphone blocked: allow it from the address bar icon and reload this page.';
});
