import EmblaCarousel from 'embla-carousel';

const screenshots = import.meta.glob('./screenshots/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

const PAGES = ['presentation', 'presentation-live', 'home', 'songs', 'add-song', 'bible'];

const lang = location.pathname.startsWith('/sv') ? 'sv' : 'en';

let viewport = 'desktop';
let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

// Build slides
const container = document.getElementById('carousel-container');
const slideImgs = PAGES.map((_, i) => {
  const slide = document.createElement('div');
  slide.className = 'embla__slide flex-none w-full px-10';
  const wrapper = document.createElement('div');
  wrapper.className = 'w-full h-[500px] flex items-center justify-center py-6';
  const img = document.createElement('img');
  img.className = 'max-w-full max-h-full w-auto h-auto rounded-2xl shadow-xl';
  img.alt = 'Screenshot of Gospel Presenter';
  img.loading = i === 0 ? 'eager' : 'lazy';
  img.decoding = 'async';
  if (i === 0) img.fetchPriority = 'high';
  wrapper.appendChild(img);
  slide.appendChild(wrapper);
  container.appendChild(slide);
  return img;
});

function updateAllImages() {
  PAGES.forEach((page, i) => {
    const key = `./screenshots/${page}_${lang}_${theme}_${viewport}.webp`;
    const url = screenshots[key];
    if (url) slideImgs[i].src = url;
  });
}

// Init Embla
const embla = EmblaCarousel(document.getElementById('carousel-viewport'), {
  loop: false,
  align: 'center',
  dragFree: false,
});

// Pills
const pillsContainer = document.getElementById('carousel-pills');
const pills = PAGES.map((_, i) => {
  const btn = document.createElement('button');
  btn.addEventListener('click', () => embla.scrollTo(i));
  pillsContainer.appendChild(btn);
  return btn;
});

function updatePills() {
  const index = embla.selectedScrollSnap();
  pills.forEach((pill, i) => {
    pill.className = i === index
      ? 'h-2 w-6 rounded-full bg-sky-500 cursor-pointer transition-all'
      : 'h-2 w-2 rounded-full bg-neutral-300 dark:bg-neutral-600 hover:bg-sky-400 cursor-pointer transition-all';
  });
}

const prevBtn = document.getElementById('carousel-prev');
const nextBtn = document.getElementById('carousel-next');
const BASE_ARROW = 'shrink-0 p-2 rounded-full bg-white dark:bg-neutral-800 shadow cursor-pointer transition-colors';

function updateArrows() {
  const canPrev = embla.canScrollPrev();
  const canNext = embla.canScrollNext();
  prevBtn.disabled = !canPrev;
  prevBtn.className = `${BASE_ARROW} ${canPrev ? 'text-neutral-600 dark:text-neutral-300 hover:text-sky-500 dark:hover:text-sky-400' : 'text-neutral-300 dark:text-neutral-600'}`;
  nextBtn.disabled = !canNext;
  nextBtn.className = `${BASE_ARROW} ${canNext ? 'text-neutral-600 dark:text-neutral-300 hover:text-sky-500 dark:hover:text-sky-400' : 'text-neutral-300 dark:text-neutral-600'}`;
}

embla.on('select', () => { updatePills(); updateArrows(); });
embla.on('init', () => { updatePills(); updateArrows(); });

prevBtn?.addEventListener('click', () => embla.scrollPrev());
nextBtn?.addEventListener('click', () => embla.scrollNext());

const ACTIVE_BTN = 'rounded-full p-2 bg-sky-500 text-white cursor-pointer';
const INACTIVE_BTN = 'rounded-full p-2 cursor-pointer text-neutral-500 dark:text-neutral-400 hover:text-sky-500 dark:hover:text-sky-400 transition-colors';

function updateFilterButtons() {
  document.querySelectorAll('[data-viewport]').forEach(btn => {
    btn.className = btn.dataset.viewport === viewport ? ACTIVE_BTN : INACTIVE_BTN;
  });
  document.querySelectorAll('[data-theme]').forEach(btn => {
    btn.className = btn.dataset.theme === theme ? ACTIVE_BTN : INACTIVE_BTN;
  });
}

document.querySelectorAll('[data-viewport]').forEach(btn => {
  btn.addEventListener('click', () => {
    viewport = btn.dataset.viewport;
    updateFilterButtons();
    updateAllImages();
  });
});

document.querySelectorAll('[data-theme]').forEach(btn => {
  btn.addEventListener('click', () => {
    theme = btn.dataset.theme;
    updateFilterButtons();
    updateAllImages();
  });
});

updateFilterButtons();
updateAllImages();
