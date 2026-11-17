const dot = document.querySelector('.cursor-dot');
window.addEventListener('pointermove', (event) => {
  dot.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
});
