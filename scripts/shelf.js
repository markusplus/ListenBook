// Shelf, 3D-stage and drag/drop visual interactions.

(function() {
      // Elements
      const fileInput = document.getElementById('file-upload');
      const dragCurtain = document.getElementById('drag-drop-curtain');
      const shelfStage = document.getElementById('bookshelf-stage');
      const tomeStage = document.getElementById('tome-3d-stage');
      const activeTome = document.getElementById('active-book-tome');
      
      // Buttons
      const btnTriggerUpload = document.getElementById('btn-trigger-upload');
      const btnReturnToShelf = document.getElementById('btn-return-to-shelf');
      const btnToggleSpread = document.getElementById('btn-toggle-spread');
      const btnShelfAdd = document.getElementById('btn-shelf-add');
      const btnBrowseFile = document.getElementById('btn-browse-file');
      const btnQuickSample = document.getElementById('btn-quick-sample');
      const interactiveCover = document.getElementById('interactive-cover');
      
      // Labels & Icons
      const toggleViewLabel = document.getElementById('toggle-view-label');
      const toggleViewIcon = document.getElementById('toggle-view-icon');
      const spreadLabel = document.getElementById('spread-label');
      const spreadIcon = document.getElementById('spread-icon');

      // Drawer Elements
      const chaptersDrawer = document.getElementById('chapters-drawer');
      const drawerBackdrop = document.getElementById('drawer-backdrop');
      const drawerContent = document.getElementById('drawer-content');
      const btnOpenChaptersDrawer = document.getElementById('btn-open-chapters-drawer');
      const btnCloseDrawer = document.getElementById('btn-close-drawer');

      let is3DViewActive = false;
      let isOpenSpread = false;

      // Helper file browser
      function openNativeFilePicker() {
        if (fileInput) fileInput.click();
      }

      function openNewBookChooserOrFilePicker() {
        if (typeof window.openNewBookSourceChooser === 'function') {
          window.openNewBookSourceChooser();
          return;
        }
        openNativeFilePicker();
      }

      // Switch between shelf & 3D tome views
      function show3DStage() {
        is3DViewActive = true;
        shelfStage.classList.add('hidden');
        tomeStage.classList.remove('hidden');
        toggleViewLabel.textContent = 'Ver Estantería de Obras';
        toggleViewIcon.textContent = 'shelves';
      }

      function showShelfStage() {
        is3DViewActive = false;
        tomeStage.classList.add('hidden');
        shelfStage.classList.remove('hidden');
        toggleViewLabel.textContent = 'Inspeccionar Ejemplar 3D';
        toggleViewIcon.textContent = 'menu_book';
      }

      // Toggle book open/close spread
      function toggleBookSpread() {
        isOpenSpread = !isOpenSpread;
        if (isOpenSpread) {
          activeTome.classList.add('is-open');
          spreadLabel.textContent = 'Cerrar Cubierta';
          spreadIcon.textContent = 'auto_stories';
        } else {
          activeTome.classList.remove('is-open');
          spreadLabel.textContent = 'Abrir Pliego Interior';
          spreadIcon.textContent = 'menu_book';
        }
      }

      // File selection events
      if (btnTriggerUpload) btnTriggerUpload.addEventListener('click', openNewBookChooserOrFilePicker);
      if (btnShelfAdd) {
        btnShelfAdd.addEventListener('click', openNewBookChooserOrFilePicker);
        btnShelfAdd.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openNewBookChooserOrFilePicker();
          }
        });
      }
      if (btnBrowseFile) btnBrowseFile.addEventListener('click', openNativeFilePicker);

      // Los tomos de ejemplo son decorativos. Los tomos guardados se abren
      // mediante el controlador de biblioteca de scripts/main.js.

      // View toggle buttons
      if (btnToggleView) {
        btnToggleView.addEventListener('click', function() {
          if (is3DViewActive) {
            showShelfStage();
          } else {
            show3DStage();
          }
        });
      }

      if (btnReturnToShelf) {
        btnReturnToShelf.addEventListener('click', showShelfStage);
      }

      if (btnToggleSpread) {
        btnToggleSpread.addEventListener('click', toggleBookSpread);
      }

      if (interactiveCover) {
        interactiveCover.addEventListener('click', toggleBookSpread);
      }

      if (btnQuickSample) {
        btnQuickSample.addEventListener('click', function() {
          show3DStage();
          setTimeout(function() {
            if (!isOpenSpread) toggleBookSpread();
          }, 350);
        });
      }

      // Global Drag and Drop handlers
      let dragCounter = 0;

      window.addEventListener('dragenter', function(e) {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault();
        dragCounter++;
        if (dragCurtain) {
          dragCurtain.classList.remove('pointer-events-none', 'opacity-0');
          dragCurtain.classList.add('opacity-100');
        }
      });

      window.addEventListener('dragleave', function(e) {
        if (!e.dataTransfer?.types?.includes('Files')) return;
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0 && dragCurtain) {
          dragCurtain.classList.add('opacity-0', 'pointer-events-none');
          dragCurtain.classList.remove('opacity-100');
          dragCounter = 0;
        }
      });

      window.addEventListener('dragover', function(e) {
        e.preventDefault();
      });

      // Drawer handlers
      function openDrawer() {
        if (chaptersDrawer && drawerContent) {
          chaptersDrawer.classList.remove('pointer-events-none', 'opacity-0');
          chaptersDrawer.classList.add('opacity-100');
          drawerContent.classList.remove('translate-x-full');
        }
      }

      function closeDrawer() {
        if (chaptersDrawer && drawerContent) {
          chaptersDrawer.classList.add('pointer-events-none', 'opacity-0');
          chaptersDrawer.classList.remove('opacity-100');
          drawerContent.classList.add('translate-x-full');
        }
      }

      if (btnOpenChaptersDrawer) btnOpenChaptersDrawer.addEventListener('click', openDrawer);
      if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closeDrawer);
      if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeDrawer);

    })();
