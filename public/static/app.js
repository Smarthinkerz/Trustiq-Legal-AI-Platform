function byId(id) { return document.getElementById(id) }
function qsa(sel) { return document.querySelectorAll(sel) }
function showToast(message) { console.log('[TrustiQ]', message) }

function showSection(sectionId) {
  qsa('.section').forEach(section => section.classList.remove('active'))
  const target = byId(sectionId)
  if (target) target.classList.add('active')
  qsa('.nav-link').forEach(link => {
    link.classList.remove('active')
    if (link.getAttribute('href') === '#' + sectionId) link.classList.add('active')
  })
}

function toggleLanguage() {
  const root = byId('html-root') || document.documentElement
  root.lang = root.lang === 'en' ? 'ar' : 'en'
  root.dir = root.dir === 'ltr' ? 'rtl' : 'ltr'
  root.classList.toggle('rtl', root.dir === 'rtl')
  showToast('Language toggled')
}

function openModal(id) { const modal = byId(id); if (modal) modal.classList.remove('hidden') }
function closeModal(id) { const modal = byId(id); if (modal) modal.classList.add('hidden') }

function showProfile() { openModal('profile-modal') }
function closeProfile() { closeModal('profile-modal') }
function showNewCaseForm() { openModal('new-case-modal') }
function closeNewCaseForm() { closeModal('new-case-modal') }
function showNewEventModal() { openModal('new-event-modal') }
function closeEventModal() { closeModal('new-event-modal') }
function closeReviewModal() { closeModal('review-modal') }
function showBrandSettings() { openModal('brand-modal') }
function closeBrandSettings() { closeModal('brand-modal') }

function filterCases(status) {
  showToast('Filter: ' + status)
}

function generateDocument() {
  showSection('documents')
  showToast('Generating document')
}
function generateDocumentNew() { generateDocument() }
function reviewDocument() { openModal('review-modal') }
function editDocument() { showToast('Opening editor') }
function downloadDocument() { showToast('Preparing download') }
function saveToCase() { showToast('Saved to case') }
function createLetterhead() { showToast('Letterhead created') }
function testBrandingSystem() { showToast('Branding system tested') }
function createNewTemplate() { showToast('Template editor opened') }
function analyzeAllDocuments() {
  const chat = byId('ai-chat')
  if (chat) {
    const bubble = document.createElement('div')
    bubble.className = 'chat-bubble bot'
    bubble.textContent = 'Document analysis complete: compliance review, risk scoring, and clause recommendations are available.'
    chat.appendChild(bubble)
    chat.scrollTop = chat.scrollHeight
  }
}
function clearAllDocuments() { showToast('Documents cleared') }

function appendChat(text, isUser = false) {
  const chat = byId('ai-chat')
  if (!chat) return
  const bubble = document.createElement('div')
  bubble.className = 'chat-bubble ' + (isUser ? 'user' : 'bot')
  bubble.textContent = text
  chat.appendChild(bubble)
  chat.scrollTop = chat.scrollHeight
}

function sendAIMessage() {
  const input = byId('ai-message')
  if (!input || !input.value.trim()) return
  const message = input.value.trim()
  appendChat(message, true)
  appendChat('TrustiQ AI response: I can help with legal analysis, document drafting, compliance checks, and GCC research.')
  input.value = ''
}

function quickAIQueryBilingual(en, ar) {
  appendChat(rootLanguage() === 'ar' ? ar : en, true)
  appendChat('AI note: This is a demo response. Connect OPENAI_API_KEY to enable live legal reasoning.')
}

function rootLanguage() {
  const root = byId('html-root') || document.documentElement
  return root.lang || 'en'
}

function showAddClientForm() { showToast('Client form opened') }
function viewClientDetails(id) {
  showSection('clients')
  showToast('Viewing client: ' + id)
}

function previousMonth() { showToast('Previous month') }
function todayView() { showToast('Today view') }
function nextMonth() { showToast('Next month') }

function saveNewEvent() { showToast('Event saved') }
function triggerLogoUpload() { showToast('Logo upload triggered') }
function clearLogo() { showToast('Logo cleared') }
function triggerWatermarkUpload() { showToast('Watermark upload triggered') }
function clearWatermark() { showToast('Watermark cleared') }
function resetBrandSettings() { showToast('Brand settings reset') }
function saveBrandSettings() { showToast('Brand settings saved') }

window.showSection = showSection
window.toggleLanguage = toggleLanguage
window.showProfile = showProfile
window.closeProfile = closeProfile
window.showNewCaseForm = showNewCaseForm
window.closeNewCaseForm = closeNewCaseForm
window.showNewEventModal = showNewEventModal
window.closeEventModal = closeEventModal
window.closeReviewModal = closeReviewModal
window.showBrandSettings = showBrandSettings
window.closeBrandSettings = closeBrandSettings
window.filterCases = filterCases
window.generateDocument = generateDocument
window.generateDocumentNew = generateDocumentNew
window.reviewDocument = reviewDocument
window.editDocument = editDocument
window.downloadDocument = downloadDocument
window.saveToCase = saveToCase
window.createLetterhead = createLetterhead
window.testBrandingSystem = testBrandingSystem
window.createNewTemplate = createNewTemplate
window.analyzeAllDocuments = analyzeAllDocuments
window.clearAllDocuments = clearAllDocuments
window.sendAIMessage = sendAIMessage
window.quickAIQueryBilingual = quickAIQueryBilingual
window.showAddClientForm = showAddClientForm
window.viewClientDetails = viewClientDetails
window.previousMonth = previousMonth
window.todayView = todayView
window.nextMonth = nextMonth
window.saveNewEvent = saveNewEvent
window.triggerLogoUpload = triggerLogoUpload
window.clearLogo = clearLogo
window.triggerWatermarkUpload = triggerWatermarkUpload
window.clearWatermark = clearWatermark
window.resetBrandSettings = resetBrandSettings
window.saveBrandSettings = saveBrandSettings

window.addEventListener('DOMContentLoaded', () => {
  const first = document.querySelector('.nav-link[href="#dashboard"]')
  if (first) first.classList.add('active')
  const input = byId('ai-message')
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendAIMessage()
    })
  }
  showToast('TrustiQ app loaded')
})
