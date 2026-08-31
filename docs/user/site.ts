type PublicAppearance = 'light' | 'dark'

const appearanceStorageKey = 'markover-pages-appearance'
const appearanceThemeColors: Readonly<Record<PublicAppearance, string>> = {
  light: '#e8e2d8',
  dark: '#242221'
}

function storedAppearance(): PublicAppearance | null {
  try {
    const value = localStorage.getItem(appearanceStorageKey)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function appearanceMediaQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null
}

function systemAppearance(): PublicAppearance {
  return appearanceMediaQuery()?.matches
    ? 'dark'
    : 'light'
}

function applyBrandAppearance(appearance: PublicAppearance): void {
  document.querySelectorAll<HTMLImageElement>([
    'img[src$="markover-mark.svg"]',
    'img[src$="markover-mark-dark.svg"]',
    'img[src$="markover-logotype.svg"]',
    'img[src$="markover-logotype-dark.svg"]',
    'img[src$="markover-lockup.svg"]',
    'img[src$="markover-lockup-dark.svg"]'
  ].join(', ')).forEach((image) => {
    const source = image.getAttribute('src')
    if (!source) return
    const lightSource = source.replace(/-dark\.svg$/, '.svg')
    image.setAttribute(
      'src',
      appearance === 'dark'
        ? lightSource.replace(/\.svg$/, '-dark.svg')
        : lightSource
    )
  })
}

function applyAppearance(appearance: PublicAppearance): void {
  document.documentElement.dataset.appearance = appearance
  document.documentElement.style.colorScheme = appearance
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', appearanceThemeColors[appearance])
  document.querySelectorAll<HTMLButtonElement>('[data-appearance-choice]')
    .forEach((button) => {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.appearanceChoice === appearance)
      )
    })
  applyBrandAppearance(appearance)
}

const appearanceButtons = document.querySelectorAll<HTMLButtonElement>(
  '[data-appearance-choice]'
)
for (const button of appearanceButtons) {
  button.addEventListener('click', () => {
    const choice = button.dataset.appearanceChoice
    if (choice !== 'light' && choice !== 'dark') return
    try {
      localStorage.setItem(appearanceStorageKey, choice)
    } catch {
      // The selected appearance still applies for this page when storage is unavailable.
    }
    applyAppearance(choice)
  })
}

applyAppearance(storedAppearance() ?? systemAppearance())

appearanceMediaQuery()?.addEventListener(
  'change',
  (event) => {
    if (storedAppearance()) return
    applyAppearance(event.matches ? 'dark' : 'light')
  }
)

const previewTrigger = document.querySelector<HTMLElement>(
  '.product-preview-trigger'
)
const previewDialog = document.querySelector<HTMLDialogElement>(
  '#product-preview'
)
const closeButton = previewDialog?.querySelector<HTMLButtonElement>(
  '.dialog-close'
)
const slides = [...(
  previewDialog?.querySelectorAll<HTMLElement>('.product-slide') || []
)]
const previousButton = previewDialog?.querySelector<HTMLButtonElement>(
  '.gallery-previous'
)
const nextButton = previewDialog?.querySelector<HTMLButtonElement>(
  '.gallery-next'
)
const galleryPosition = previewDialog?.querySelector<HTMLElement>(
  '#gallery-position'
)
let activeSlide = 0

function showSlide(index: number): void {
  if (!slides.length) return
  activeSlide = (index + slides.length) % slides.length
  slides.forEach((slide, slideIndex) => {
    slide.hidden = slideIndex !== activeSlide
  })
  const active = slides[activeSlide]
  if (!active || !galleryPosition) return
  const image = active.querySelector<HTMLImageElement>('img[data-src]')
  if (image && !image.hasAttribute('src')) {
    image.src = image.dataset.src || ''
  }
  galleryPosition.textContent = `${activeSlide + 1} / ${slides.length}`
}

if (
  previewTrigger &&
  previewDialog?.showModal &&
  closeButton &&
  previousButton &&
  nextButton &&
  galleryPosition
) {
  previewTrigger.addEventListener('click', (event) => {
    event.preventDefault()
    showSlide(0)
    previewDialog.showModal()
  })

  closeButton.addEventListener('click', () => {
    previewDialog.close()
  })
  previousButton.addEventListener('click', () => {
    showSlide(activeSlide - 1)
  })
  nextButton.addEventListener('click', () => {
    showSlide(activeSlide + 1)
  })

  previewDialog.addEventListener('click', (event) => {
    if (event.target === previewDialog) previewDialog.close()
  })

  previewDialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      showSlide(activeSlide - 1)
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      showSlide(activeSlide + 1)
    }
  })
}
