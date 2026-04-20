import EmblaCarousel from 'embla-carousel';

const screenshots = import.meta.glob('./screenshots/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

const PAGES = ['presentation', 'presentation-live', 'home', 'songs', 'add-song', 'bible'];

const lang = location.pathname.startsWith('/sv') ? 'sv' : 'en';

let viewport = window.matchMedia('(max-width: 640px)').matches ? 'mobile' : 'desktop';
let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const CROSSFADE_MS = 400;
const IMG_CLASS = 'absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-w-full max-h-full w-auto h-auto rounded-[18px] shadow-xl outline outline-[0.5px] outline-black/5';

// Build slides — each slide has two stacked images (CSS grid) for crossfade
const container = document.getElementById('carousel-container');
const slidePairs = PAGES.map((_, i) => {
  const slide = document.createElement('div');
  slide.className = 'embla__slide flex-none w-full px-10';
  const wrapper = document.createElement('div');
  wrapper.className = 'relative w-full h-[600px]';
  const inner = document.createElement('div');
  inner.className = 'absolute top-4 bottom-10 left-2 right-2';
  wrapper.appendChild(inner);

  const makeImg = (eager) => {
    const img = document.createElement('img');
    img.className = IMG_CLASS;
    img.alt = 'Screenshot of Gospel Presenter';
    img.loading = eager ? 'eager' : 'lazy';
    img.decoding = 'async';
    if (eager) img.fetchPriority = 'high';
    return img;
  };

  const front = makeImg(i === 0);
  const back = makeImg(false);
  back.style.opacity = '0';

  inner.appendChild(back);
  inner.appendChild(front);
  slide.appendChild(wrapper);
  container.appendChild(slide);
  return { front, back };
});

let activeController = null;

function setTransition(img, enabled) {
  img.style.transition = enabled ? `opacity ${CROSSFADE_MS}ms ease-in-out` : 'none';
}

async function updateAllImages() {
  if (activeController) activeController.abort();
  const controller = new AbortController();
  activeController = controller;
  const { signal } = controller;

  // Immediately settle any in-progress animation
  slidePairs.forEach(({ front, back }) => {
    if (back.src) front.src = back.src;
    setTransition(front, false);
    setTransition(back, false);
    front.style.opacity = '1';
    back.style.opacity = '0';
    back.removeAttribute('src');
  });

  const newUrls = PAGES.map(page => screenshots[`./screenshots/${page}_${lang}_${theme}_${viewport}.webp`]);
  const isFirstLoad = !slidePairs[0].front.src;

  await Promise.all(newUrls.map(url => {
    if (!url) return Promise.resolve();
    const tmp = new Image();
    tmp.src = url;
    return tmp.decode().catch(() => {});
  }));
  if (signal.aborted) return;

  if (isFirstLoad) {
    slidePairs.forEach(({ front }, i) => { if (newUrls[i]) front.src = newUrls[i]; });
    activeController = null;
    return;
  }

  // Load new images into back layer (still invisible)
  slidePairs.forEach(({ back }, i) => { if (newUrls[i]) back.src = newUrls[i]; });

  // Wait a frame so browser commits back at opacity:0 before transitioning
  await new Promise(r => requestAnimationFrame(r));
  if (signal.aborted) return;

  // Crossfade
  slidePairs.forEach(({ front, back }) => {
    setTransition(front, true);
    setTransition(back, true);
    back.style.opacity = '1';
    front.style.opacity = '0';
  });

  await new Promise(r => setTimeout(r, CROSSFADE_MS));
  if (signal.aborted) return;

  // Reset layers without animation
  slidePairs.forEach(({ front, back }) => {
    setTransition(front, false);
    setTransition(back, false);
    front.src = back.src;
    front.style.opacity = '1';
    back.style.opacity = '0';
    back.removeAttribute('src');
  });

  activeController = null;
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
function updateArrows() {
  const canPrev = embla.canScrollPrev();
  const canNext = embla.canScrollNext();
  prevBtn.disabled = !canPrev;
  prevBtn.className = `cursor-pointer transition-colors ${canPrev ? 'text-neutral-500 dark:text-neutral-400 hover:text-sky-500 dark:hover:text-sky-400' : 'text-neutral-300 dark:text-neutral-600'}`;
  nextBtn.disabled = !canNext;
  nextBtn.className = `cursor-pointer transition-colors ${canNext ? 'text-neutral-500 dark:text-neutral-400 hover:text-sky-500 dark:hover:text-sky-400' : 'text-neutral-300 dark:text-neutral-600'}`;
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
