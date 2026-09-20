(function () {
  var themes = ["light", "cream", "sage", "clay", "dusk"];
  var theme = "light";

  try {
    var storedTheme = window.localStorage.getItem("prepdeck.theme");
    if (themes.indexOf(storedTheme) !== -1) theme = storedTheme;
  } catch (_) {
    // Storage can be unavailable in privacy-restricted browsers. Use Light.
  }

  document.documentElement.setAttribute("data-pd-theme", theme);
})();
