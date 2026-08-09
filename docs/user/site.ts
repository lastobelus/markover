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
