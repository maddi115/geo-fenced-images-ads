// Element creation and manipulation utilities

function createElement(tag, className = '', attrs = {}) {
  const element = document.createElement(tag);
  
  if (className) {
    element.className = className;
  }
  
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'textContent') {
      element.textContent = value;
    } else if (key === 'disabled') {
      element.disabled = value;
    } else {
      element.setAttribute(key, value);
    }
  });
  
  return element;
}

function setStyles(element, styles) {
  Object.entries(styles).forEach(([property, value]) => {
    element.style[property] = value;
  });
}

function appendChildren(parent, children) {
  children.forEach(child => {
    if (child) {
      parent.appendChild(child);
    }
  });
}
