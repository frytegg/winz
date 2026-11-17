// Served from a second local origin: a Wayback replay must block it, so this element must never appear.
document.body.insertAdjacentHTML('beforeend', '<div class="leaked">leaked from another origin</div>');
