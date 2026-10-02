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
