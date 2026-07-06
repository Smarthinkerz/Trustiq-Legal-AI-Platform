window.showSection = function (sectionId) {
  document.querySelectorAll('.section').forEach(section => section.classList.remove('active'))
  const target = document.getElementById(sectionId)
  if (target) target.classList.add('active')
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.remove('active')
    if (link.getAttribute('href') === '#' + sectionId) link.classList.add('active')
  })
}

window.toggleLanguage = function () {
  const root = document.getElementById('html-root') || document.documentElement
  root.dir = root.dir === 'rtl' ? 'ltr' : 'rtl'
  root.lang = root.lang === 'ar' ? 'en' : 'ar'
}

console.log('TrustiQ navigation helpers loaded')
