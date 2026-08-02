const previewTrigger = document.querySelector('.product-preview-trigger')
const previewDialog = document.querySelector('#product-preview')
const closeButton = previewDialog?.querySelector('.dialog-close')
const slides = [...(previewDialog?.querySelectorAll('.product-slide') || [])]
const previousButton = previewDialog?.querySelector('.gallery-previous')
const nextButton = previewDialog?.querySelector('.gallery-next')
const galleryPosition = previewDialog?.querySelector('#gallery-position')
let activeSlide = 0

function showSlide(index) {
  if (!slides.length) return
  activeSlide = (index + slides.length) % slides.length
  slides.forEach((slide, slideIndex) => {
    slide.hidden = slideIndex !== activeSlide
  })
  const image = slides[activeSlide].querySelector('img[data-src]')
  if (image && !image.hasAttribute('src')) {
    image.src = image.dataset.src
  }
  galleryPosition.textContent = `${activeSlide + 1} / ${slides.length}`
}

if (previewTrigger && previewDialog?.showModal) {
  previewTrigger.addEventListener('click', (event) => {
    event.preventDefault()
    showSlide(0)
    previewDialog.showModal()
  })

  closeButton.addEventListener('click', () => previewDialog.close())
  previousButton.addEventListener('click', () => showSlide(activeSlide - 1))
  nextButton.addEventListener('click', () => showSlide(activeSlide + 1))

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
