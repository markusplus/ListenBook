// Interactive 3D book and page spread controller.

// DOM References
  const bookTome = document.getElementById('bookTome');
  const frontCover = document.getElementById('frontCover');
  const toggleBookBtn = document.getElementById('toggleBookBtn');
  const bookToggleIcon = document.getElementById('bookToggleIcon');
  const bookToggleLabel = document.getElementById('bookToggleLabel');
  const bookPrevRibbon = document.getElementById('bookPrevRibbon');
  const pageStateBadge = document.getElementById('pageStateBadge');
  const groundShadow = document.getElementById('groundShadow');
  const guideBarHelpText = document.getElementById('guideBarHelpText');

  // Spreads & 4-Page Flip Controls
  const spreadSet1 = document.getElementById('spreadSet1');
  const spreadSet2 = document.getElementById('spreadSet2');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  let currentSpreadIndex = 1; // 1 = Páginas 1-2, 2 = Páginas 3-4

  // Book Selection Counters & Synced UI
  const getChapterCheckboxes = () => document.querySelectorAll('#bookOpenVolume .chapter-cb');
  const actionHeadingCount = document.getElementById('actionHeadingCount');
  const actionCalculatedTime = document.getElementById('actionCalculatedTime');
  const synthesisBtnText = document.getElementById('synthesisBtnText');
  const bookSelectAllBtn = document.getElementById('bookSelectAllBtn');
  const bookClearAuxBtn = document.getElementById('bookClearAuxBtn');

  // Initial state: Completely CLOSED showing pristine cover and realistic fore-edge
  let isBookOpen = false;

  function setBookOpen(open) {
    isBookOpen = open;
    if (open) {
      bookTome.classList.add('is-open');
      bookToggleLabel.textContent = 'Cerrar libro';
      bookToggleIcon.textContent = 'close';
      groundShadow.classList.add('scale-110', 'opacity-80');
      updateSpreadDisplay(false);
      if (guideBarHelpText) guideBarHelpText.textContent = 'Usa las flechas para hojear entre las páginas';
    } else {
      bookTome.classList.remove('is-open');
      bookToggleLabel.textContent = 'Abrir libro para hojear';
      bookToggleIcon.textContent = 'auto_stories';
      groundShadow.classList.remove('scale-110', 'opacity-80');
      pageStateBadge.textContent = 'Cerrado';
      if (guideBarHelpText) guideBarHelpText.textContent = 'Haz clic para abrir y hojear las páginas';
    }
  }

  function updateSpreadDisplay(animate = true) {
    if (!isBookOpen) return;

    if (currentSpreadIndex === 1) {
      pageStateBadge.textContent = 'Págs 1 - 2';
      if (prevPageBtn) prevPageBtn.disabled = true;
      if (nextPageBtn) nextPageBtn.disabled = false;

      if (animate) {
        spreadSet2.classList.add('flipping-out-right');
        setTimeout(() => {
          spreadSet2.classList.add('hidden');
          spreadSet2.classList.remove('flipping-out-right');
          spreadSet1.classList.remove('hidden');
          spreadSet1.classList.add('flipping-in');
          setTimeout(() => {
            spreadSet1.classList.remove('flipping-in');
            spreadSet1.style.opacity = '1';
          }, 350);
        }, 200);
      } else {
        spreadSet2.classList.add('hidden');
        spreadSet2.style.opacity = '0';
        spreadSet1.classList.remove('hidden');
        spreadSet1.style.opacity = '1';
      }
    } else {
      pageStateBadge.textContent = 'Págs 3 - 4';
      if (prevPageBtn) prevPageBtn.disabled = false;
      if (nextPageBtn) nextPageBtn.disabled = true;

      if (animate) {
        spreadSet1.classList.add('flipping-out-left');
        setTimeout(() => {
          spreadSet1.classList.add('hidden');
          spreadSet1.classList.remove('flipping-out-left');
          spreadSet1.style.opacity = '0';
          spreadSet2.classList.remove('hidden');
          spreadSet2.classList.add('flipping-in');
          setTimeout(() => {
            spreadSet2.classList.remove('flipping-in');
            spreadSet2.style.opacity = '1';
          }, 350);
        }, 200);
      } else {
        spreadSet1.classList.add('hidden');
        spreadSet1.style.opacity = '0';
        spreadSet2.classList.remove('hidden');
        spreadSet2.style.opacity = '1';
      }
    }
  }

  // Hover to preview opening (with comfortable delay)
  let hoverTimeout;
  bookTome.addEventListener('mouseenter', () => {
    if (!isBookOpen) {
      hoverTimeout = setTimeout(() => {
        setBookOpen(true);
      }, 350);
    }
  });

  bookTome.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimeout);
  });

  // Direct Clicks to Open/Close
  if (frontCover) {
    frontCover.addEventListener('click', (e) => {
      e.stopPropagation();
      setBookOpen(!isBookOpen);
    });
  }

  if (toggleBookBtn) {
    toggleBookBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setBookOpen(!isBookOpen);
    });
  }

  if (bookPrevRibbon) {
    bookPrevRibbon.addEventListener('click', (e) => {
      e.stopPropagation();
      setBookOpen(false);
    });
  }

  // Page Navigation Handlers
  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isBookOpen) setBookOpen(true);
      if (currentSpreadIndex > 1) {
        currentSpreadIndex = 1;
        updateSpreadDisplay(true);
      }
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isBookOpen) setBookOpen(true);
      if (currentSpreadIndex < 2) {
        currentSpreadIndex = 2;
        updateSpreadDisplay(true);
      }
    });
  }

  // Synchronize Live Checkboxes & Calculations
  function updateSelectAllButton() {
    if (!bookSelectAllBtn) return;
    const chapterCheckboxes = Array.from(getChapterCheckboxes());
    const selectable = chapterCheckboxes.filter(cb => !cb.disabled);
    const allSelected = selectable.length > 0 && selectable.every(cb => cb.checked);
    bookSelectAllBtn.textContent = `${allSelected ? 'Desmarcar todos' : 'Marcar todos'} (${selectable.length})`;
  }

  function updateCalculations() {
    let checkedCount = 0;
    let totalMinutes = 0;
    const chapterCheckboxes = getChapterCheckboxes();

    chapterCheckboxes.forEach(cb => {
      if (cb.checked) {
        checkedCount++;
        const mins = parseInt(cb.getAttribute('data-duration') || '40', 10);
        totalMinutes += mins;
      }
    });

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const timeFormatted = `~${hours}h ${minutes < 10 ? '0' : ''}${minutes}m`;

    if (actionHeadingCount) {
      actionHeadingCount.textContent = `${checkedCount} capítulos seleccionados`;
    }
    if (actionCalculatedTime) {
      actionCalculatedTime.textContent = timeFormatted;
    }
    if (synthesisBtnText) {
      synthesisBtnText.textContent = `Procesar capítulos seleccionados (${checkedCount})`;
    }
    updateSelectAllButton();
  }

  getChapterCheckboxes().forEach(cb => {
    cb.addEventListener('change', updateCalculations);
    cb.addEventListener('click', (e) => e.stopPropagation());
  });

  if (bookSelectAllBtn) {
    bookSelectAllBtn.addEventListener('click', () => {
      const selectable = Array.from(getChapterCheckboxes()).filter(cb => !cb.disabled);
      const allSelected = selectable.length > 0 && selectable.every(cb => cb.checked);
      selectable.forEach(cb => {
        cb.checked = !allSelected;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });
      updateCalculations();
    });
  }

  if (bookClearAuxBtn) {
    bookClearAuxBtn.addEventListener('click', () => {
      const chapterCheckboxes = getChapterCheckboxes();
      if (chapterCheckboxes[0] && !chapterCheckboxes[0].disabled) chapterCheckboxes[0].checked = false;
      for (let i = 1; i < chapterCheckboxes.length; i++) {
        if (!chapterCheckboxes[i].disabled) chapterCheckboxes[i].checked = true;
      }
      updateCalculations();
    });
  }

  // Voice sample wave preview toggle
  const previewBtn = document.getElementById('previewVoiceBtn');
  const playIcon = document.getElementById('playIcon');
  const waveformBars = document.getElementById('waveformBars')?.children;
  let isPlaying = false;
  let waveInterval;

  if (previewBtn && playIcon) {
    previewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isPlaying = !isPlaying;
      if (isPlaying) {
        playIcon.textContent = 'pause';
        waveInterval = setInterval(() => {
          if (!waveformBars) return;
          Array.from(waveformBars).forEach(bar => {
            const randH = Math.floor(Math.random() * 24) + 6;
            bar.style.height = `${randH}px`;
          });
        }, 150);
      } else {
        playIcon.textContent = 'play_arrow';
        clearInterval(waveInterval);
      }
    });
  }

  // La síntesis real se conecta desde main.js cuando se carga un EPUB.

  // Initialize calculations on load
  updateCalculations();
