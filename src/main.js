const { invoke } = window.__TAURI__.tauri;

const getElementById = id => document.getElementById(id);
const addEventListener = (element, event, handler) => element.addEventListener(event, handler);
const toggleClass = (element, className) => element.classList.toggle(className);
const removeClass = (element, className) => element.classList.remove(className);
const addClass = (element, className) => element.classList.add(className);
const handleError = (error, message) => console.error(`${message} ${error}`);

const sidebar = document.querySelector('.sidebar');
const content = document.querySelector('.content');
const toggleButton = document.querySelector('.sidebar-toggle');


let isMouseDown = false; // Flag to track if the mouse is pressed down


/* tauri related stuff */
async function invokeTauri(command, args) {
  try {
    return await invoke(command, args);
  } catch (error) {
    handleError(error, `Error invoking ${command}:`);
  }
}


function updateGlowEffect() {
  const glowSize = document.getElementById('glow-size-slider').value;
  const glowIntensity = document.getElementById('glow-intensity-slider').value;

  // Update the CSS variable for the glow effect
  const ledMatrix = document.getElementById('led-matrix');
  ledMatrix.style.setProperty('--glow-size', `${glowSize}px`);
  ledMatrix.style.setProperty('--glow-intensity', `${glowIntensity}px`);
}


document.addEventListener('DOMContentLoaded', async () => {
  createLedMatrix();
  
  const deviceFound = await findDevice();
  if (deviceFound) {
    console.log('Device found');
  } else {
    console.log('Device not found');
  }

    const glowSizeSlider = document.getElementById('glow-size-slider');
    const glowIntensitySlider = document.getElementById('glow-intensity-slider');

    glowSizeSlider.addEventListener('input', updateGlowEffect);
    glowIntensitySlider.addEventListener('input', updateGlowEffect);

    updateGlowEffect();
});

document.querySelectorAll('.sidebar-button').forEach(button => {
  addEventListener(button, 'click', () => {
    const target = button.getAttribute('data-target');
    document.querySelectorAll('.window').forEach(window => {
      removeClass(window, 'active');
    });
    addClass(getElementById(target), 'active');
  });
});

addEventListener(toggleButton, 'click', () => {
  toggleClass(sidebar, 'collapsed');
  toggleClass(content, 'shifted');
});





/* led matrix related stuff */
function handleLedMouseDown(index) {
  isMouseDown = true;
  updateLedColor(index);
}

function handleLedMouseOver(index) {
  if (isMouseDown) {
    updateLedColor(index);
  }
}

function handleMouseUp() {
  isMouseDown = false;
}

async function updateLedColor(index) {
  const colorPicker = getElementById('color-picker');
  const color = colorPicker.value;
  const led = document.querySelector(`.led[data-index="${index}"]`);
  led.style.backgroundColor = color;
  const r = parseInt(color.substr(1, 2), 16);
  const g = parseInt(color.substr(3, 2), 16);
  const b = parseInt(color.substr(5, 2), 16);

  const ledColor = {
    index: index,
    color: { r, g, b }
  };

  if (color !== '#000000') {
    console.log(color);
    led.classList.add('active');
    led.style.setProperty('--led-glow-color', color); // Set the glow color
  } else {
    led.classList.remove('active');
  }

  await invokeTauri('update_led_color', { ledColor });
}

function createLedMatrix() {
  const ledMatrix = getElementById('led-matrix');
  for (let i = 0; i < 8 * 24; i++) {
    const led = document.createElement('div');
    led.classList.add('led');
    led.dataset.index = i;
    ledMatrix.appendChild(led);
    led.addEventListener('mousedown', () => handleLedMouseDown(i));
    led.addEventListener('mouseover', () => handleLedMouseOver(i));
    addEventListener(led, 'click', () => updateLedColor(i));
  }
  document.addEventListener('mouseup', handleMouseUp);
}





/* device related stuff */
const deviceList = getElementById('device-list');
const deviceListItems = deviceList.querySelectorAll('li');

async function findDevice() {
  return await invokeTauri('find_device');
}

async function updateDeviceColor(device, color) {
  await invokeTauri('update_device_color', { device, color });
}

addEventListener(getElementById('update-firmware'), 'click', async () => {
  try {
    await invokeTauri('update_firmware');
    alert('Firmware updated successfully!');
  } catch (error) {
    handleError(error, 'Error updating firmware:');
    alert('Failed to update firmware.');
  }
});

async function updateDeviceStatus() {
  try {
    const status = await invokeTauri('get_device_status');
    getElementById('status-display').textContent = status ? 'Connected' : 'Disconnected';
  } catch (error) {
    handleError(error, 'Error getting device status:');
  }
}

deviceListItems.forEach(item => {
  addEventListener(item, 'click', async () => {
    const device = item.textContent;
    await updateDeviceColor(device, '#000000');
    const selectedDevice = deviceList.querySelector('.selected');
    if (selectedDevice) {
      removeClass(selectedDevice, 'selected');
    }
    addClass(item, 'selected');
  });
});




updateDeviceStatus();
