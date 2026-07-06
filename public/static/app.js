function showSection(sectionId) {
  document.querySelectorAll('.section').forEach(section => section.classList.remove('active'))
  const target = document.getElementById(sectionId)
  if (target) target.classList.add('active')
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active')
    if (link.getAttribute('href') === '#' + sectionId) link.classList.add('active')
  })
}

function toggleLanguage() {
  const html = document.getElementById('html-root') || document.documentElement
  html.lang = html.lang === 'en' ? 'ar' : 'en'
  html.dir = html.dir === 'ltr' ? 'rtl' : 'ltr'
}

function initApp() {
  const first = document.querySelector('.nav-link[href="#dashboard"]')
  if (first) first.classList.add('active')
}

window.showSection = showSection
window.toggleLanguage = toggleLanguage
window.addEventListener('DOMContentLoaded', initApp)
