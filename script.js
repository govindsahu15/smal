document.addEventListener('DOMContentLoaded', function() {
    includeHTML('header.html', 'header');
    includeHTML('footer.html', 'footer');
});

function includeHTML(url, elementId) {
    fetch(url)
    .then(response => response.text())
    .then(data => {
        document.getElementById(elementId).innerHTML = data;
    })
    .catch(error => {
        console.error('Error loading HTML:', error);
    });
}
