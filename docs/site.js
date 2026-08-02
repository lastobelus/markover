const previewTrigger = document.querySelector('.product-preview-trigger')
const previewDialog = document.querySelector('#product-preview')
const closeButton = previewDialog?.querySelector('.dialog-close')

if (previewTrigger && previewDialog?.showModal) {
  previewTrigger.addEventListener('click', (event) => {
    event.preventDefault()
    previewDialog.showModal()
  })

  closeButton.addEventListener('click', () => previewDialog.close())

  previewDialog.addEventListener('click', (event) => {
    if (event.target === previewDialog) previewDialog.close()
  })
}
