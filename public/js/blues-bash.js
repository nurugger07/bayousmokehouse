(function () {
  var toggle = document.querySelector('.bb-nav-toggle');
  var nav = document.getElementById('bb-primary-nav');
  if (!toggle || !nav) return;

  function setOpen(isOpen) {
    nav.classList.toggle('bb-nav--open', isOpen);
    toggle.setAttribute('aria-expanded', String(isOpen));
  }

  toggle.addEventListener('click', function () {
    setOpen(!nav.classList.contains('bb-nav--open'));
  });

  nav.addEventListener('click', function (event) {
    if (event.target.tagName === 'A') {
      setOpen(false);
    }
  });
})();

// "What folks are saying" quote rotator: auto-advances on a timer,
// pauses while hovered or focused so it never changes mid-read, and
// clicking a slide (or either arrow) advances/reverses immediately and
// resets the timer so it doesn't double-jump right after that.
(function () {
  var root = document.getElementById('bb-quotes');
  if (!root) return;

  var slides = Array.prototype.slice.call(root.querySelectorAll('.bb-quotes__slide'));
  if (slides.length < 2) return;

  var prevBtn = root.querySelector('[data-quotes-prev]');
  var nextBtn = root.querySelector('[data-quotes-next]');
  var current = 0;
  var timer = null;
  var isAnimating = false;
  var FADE_MS = 400;
  var INTERVAL_MS = 6000;

  // Ignores calls while a transition is already in flight -- without
  // this guard, a click landing mid-fade (or racing the auto-advance
  // timer) desyncs `current` from the DOM and can leave every slide
  // hidden at once.
  function show(index) {
    if (isAnimating || index === current) return;
    isAnimating = true;

    var from = slides[current];
    var to = slides[index];

    from.classList.remove('is-active');
    setTimeout(function () {
      from.hidden = true;
      to.hidden = false;
      void to.offsetWidth; // force reflow so the fade-in transition actually runs
      to.classList.add('is-active');
      isAnimating = false;
    }, FADE_MS);

    current = index;
  }

  function next() {
    show((current + 1) % slides.length);
  }

  function prev() {
    show((current - 1 + slides.length) % slides.length);
  }

  function start() {
    stop();
    timer = setInterval(next, INTERVAL_MS);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  slides.forEach(function (slide) {
    slide.addEventListener('click', function () {
      next();
      start();
    });

    slide.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        next();
        start();
      }
    });
  });

  if (nextBtn) {
    nextBtn.addEventListener('click', function () {
      next();
      start();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', function () {
      prev();
      start();
    });
  }

  root.addEventListener('mouseenter', stop);
  root.addEventListener('mouseleave', start);
  root.addEventListener('focusin', stop);
  root.addEventListener('focusout', start);

  start();
})();

// Lineup carousel: arrow buttons scroll the track by one card's width
// (plus the gap between cards) so each click lands the next card at
// the start of the snap alignment, rather than an arbitrary distance.
(function () {
  var track = document.getElementById('bb-lineup-track');
  var prevBtn = document.querySelector('[data-lineup-prev]');
  var nextBtn = document.querySelector('[data-lineup-next]');
  if (!track || !prevBtn || !nextBtn) return;

  function cardStep() {
    var card = track.querySelector('.bb-artist-card');
    if (!card) return track.clientWidth;
    var gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    return card.getBoundingClientRect().width + gap;
  }

  prevBtn.addEventListener('click', function () {
    track.scrollBy({ left: -cardStep(), behavior: 'smooth' });
  });

  nextBtn.addEventListener('click', function () {
    track.scrollBy({ left: cardStep(), behavior: 'smooth' });
  });
})();

// Artist modal: each card's "Read More" button carries the artist's
// details as data attributes, so one dialog can be populated and
// reused for whichever artist was clicked rather than rendering a
// separate modal per artist. Native <dialog> gives us Escape-to-close
// and backdrop focus-trapping for free.
(function () {
  var modal = document.getElementById('bb-artist-modal');
  var triggers = document.querySelectorAll('[data-artist-modal-trigger]');
  if (!modal || !triggers.length) return;

  var photo = document.getElementById('bb-artist-modal-photo');
  var badge = document.getElementById('bb-artist-modal-badge');
  var name = document.getElementById('bb-artist-modal-name');
  var time = document.getElementById('bb-artist-modal-time');
  var bio = document.getElementById('bb-artist-modal-bio');
  var links = document.getElementById('bb-artist-modal-links');
  var closeBtn = modal.querySelector('[data-artist-modal-close]');

  function addLink(href, label) {
    var a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'bb-btn bb-btn--small bb-btn--outline';
    links.appendChild(a);
  }

  // Popup bios may carry multiple paragraphs separated by a blank line
  // so longer bios stay skimmable instead of running together as one
  // block -- each becomes its own <p> rather than relying on
  // textContent, which would collapse the blank lines.
  function renderBio(text) {
    bio.innerHTML = '';
    text.split(/\n\s*\n/).forEach(function (paragraph) {
      var p = document.createElement('p');
      p.textContent = paragraph.trim();
      bio.appendChild(p);
    });
  }

  triggers.forEach(function (trigger) {
    trigger.addEventListener('click', function () {
      var data = trigger.dataset;

      photo.src = data.photo;
      photo.style.objectPosition = 'center ' + data.photoPosition;
      photo.alt = data.name + ' performing';
      name.textContent = data.name;
      time.textContent = data.time;
      renderBio(data.bio);
      badge.hidden = !data.headliner;

      links.innerHTML = '';
      if (data.musicUrl) addLink(data.musicUrl, 'Listen');
      if (data.websiteUrl) addLink(data.websiteUrl, 'Website');

      modal.showModal();
    });
  });

  closeBtn.addEventListener('click', function () {
    modal.close();
  });

  modal.addEventListener('click', function (event) {
    if (event.target === modal) modal.close();
  });
})();
