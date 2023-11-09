const { invoke } = window.__TAURI__.tauri;

async function findDevice() {
  try {
    const device = await invoke('find_device');
    return device;
  } catch (error) {
    console.error('Error finding device:', error);
  }
}

async function updateDeviceColor(device, color) {
  try {
    await invoke('update_device_color', { device, color });
  } catch (error) {
    console.error('Error updating device color:', error);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const colorPicker = document.getElementById('color-picker');
  const ledMatrix = document.getElementById('led-matrix');

  // Create the LED matrix
  for (let i = 0; i < 8 * 24; i++) {
    console.log('Creating LED', i);
    const led = document.createElement('div');
    led.classList.add('led');
    led.dataset.index = i;
    ledMatrix.appendChild(led);

    // Add click event listener for each LED
    led.addEventListener('click', async () => {
      const color = colorPicker.value;
      led.style.backgroundColor = color; // Visually update the LED color

      const r = parseInt(color.substr(1, 2), 16);
      const g = parseInt(color.substr(3, 2), 16);
      const b = parseInt(color.substr(5, 2), 16);

      // Update the LED color in the backend
      try {
        await invoke('update_led_color', { index: i, color: { r, g, b } });
      } catch (error) {
        console.error('Error updating LED color:', error);
      }
    });
  }
});


// Sidebar navigation logic
document.querySelectorAll('.sidebar-button').forEach(button => {
  button.addEventListener('click', () => {
    const target = button.getAttribute('data-target');
    document.querySelectorAll('.window').forEach(window => {
      window.classList.remove('active');
    });
    document.getElementById(target).classList.add('active');
  });
});

// Settings window logic
document.getElementById('update-firmware').addEventListener('click', async () => {
  try {
    await invoke('update_firmware');
    alert('Firmware updated successfully!');
  } catch (error) {
    console.error('Error updating firmware:', error);
    alert('Failed to update firmware.');
  }
});


// Device status logic (impl backend)
async function updateDeviceStatus() {
  try {
    const status = await invoke('get_device_status');
    document.getElementById('status-display').textContent = status ? 'Connected' : 'Disconnected';
  } catch (error) {
    console.error('Error getting device status:', error);
  }
}

updateDeviceStatus();


// Sidebar toggle logic
const sidebar = document.querySelector('.sidebar');
const content = document.querySelector('.content');
const toggleButton = document.querySelector('.sidebar-toggle');


toggleButton.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  content.classList.toggle('shifted');
});