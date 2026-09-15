(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('primary-nav');
  if (!toggle || !nav) return;

  function setOpen(isOpen) {
    nav.classList.toggle('site-nav--open', isOpen);
    toggle.classList.toggle('nav-toggle--active', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
  }

  toggle.addEventListener('click', function () {
    setOpen(!nav.classList.contains('site-nav--open'));
  });

  nav.addEventListener('click', function (event) {
    if (event.target.tagName === 'A') {
      setOpen(false);
    }
  });
})();
