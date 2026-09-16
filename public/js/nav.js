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

// Admin nav dropdowns (e.g. "Sales") — independent of the mobile nav
// toggle above, so it still runs on admin pages that don't have one.
(function () {
  var dropdowns = document.querySelectorAll('.dropdown');
  if (!dropdowns.length) return;

  dropdowns.forEach(function (dropdown) {
    var toggle = dropdown.querySelector('.dropdown__toggle');
    if (!toggle) return;

    toggle.addEventListener('click', function (event) {
      event.stopPropagation();
      var isOpen = dropdown.classList.toggle('dropdown--open');
      toggle.setAttribute('aria-expanded', String(isOpen));
      dropdowns.forEach(function (other) {
        if (other !== dropdown) {
          other.classList.remove('dropdown--open');
          var otherToggle = other.querySelector('.dropdown__toggle');
          if (otherToggle) otherToggle.setAttribute('aria-expanded', 'false');
        }
      });
    });
  });

  document.addEventListener('click', function () {
    dropdowns.forEach(function (dropdown) {
      dropdown.classList.remove('dropdown--open');
      var toggle = dropdown.querySelector('.dropdown__toggle');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    });
  });
})();
