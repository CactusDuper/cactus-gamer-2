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





/* more generic stuff */
document.addEventListener('DOMContentLoaded', async () => {
  createLedMatrix();
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
  const colorPicker = getElementById('color-picker');
  updateLedColor(index, colorPicker.value);
}

function handleLedMouseOver(index) {
  if (isMouseDown) {
    const colorPicker = getElementById('color-picker');
    updateLedColor(index, colorPicker.value);
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

  await invokeTauri('update_led_color', { index: i, color: { r, g, b } });
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
