window.scrollElementToTop = function (elementId) {
    const element = document.getElementById(elementId);
    
    if (element) {
        element.scrollTop = 0;
    }
}

window.setRootElementBackgroundColor = function(color) {
    document.documentElement.style.backgroundColor = color;    
}
