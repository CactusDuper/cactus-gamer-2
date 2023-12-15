const { dialog, invoke } = window.__TAURI__.tauri;
const { open, save } = window.__TAURI__.dialog;

const getElementById = id => document.getElementById(id);
const addEventListener = (element, event, handler) => element.addEventListener(event, handler);
const toggleClass = (element, className) => element.classList.toggle(className);
const removeClass = (element, className) => element.classList.remove(className);
const addClass = (element, className) => element.classList.add(className);
const handleError = (error, message) => console.error(`${message} ${error}`);

const deviceMapping = {};
const currentToolPerDevice = {};

let totalDevices = 0;

const sidebar = document.querySelector('.sidebar');
const content = document.querySelector('.content');
const toggleButton = document.querySelector('.sidebar-toggle');

let isMouseDown = false; // Flag to track if the mouse is pressed down

function calculateLedIndex(row, col, width, height) {
  // Determine if the current column is going upwards or downwards.
  let isGoingUp = col % 2 === 0;
  // Calculate the row index depending on the serpentine direction.
  // Since in the software, the top left is clicked but it needs to address the bottom left,
  // you need to reverse the row index by subtracting from the maximum index (height - 1).
  let adjustedRow = (height - 1) - row; // This inverts the row to match the board layout.
  // Calculate the index based on whether it's going up or down.
  return isGoingUp ? col * height + adjustedRow : col * height + row;
}

function registerDevice(deviceNumber, deviceInfo){
  deviceMapping[deviceNumber] = deviceInfo;
}

/* tauri related stuff */
async function invokeTauri(command, args) {
  try {
    return await invoke(command, args);
  } catch (error) {
    handleError(error, `Error invoking ${command}:`);
  }
}

async function readTemperatures(deviceNumber) {
  try {

    const serial_number = serialNumberFromDeviceNumber(deviceNumber); // Get the serial number from the device number

    // Invoke the Rust function to get temperature data
    const temperatures = await invokeTauri('get_temperature', { serial_number });
    
    // Process and display the temperatures
    if (temperatures) {
      temperatures.forEach((temp, index) => {
        const tempElement = getElementById(`temperature-sensor-${index}-${deviceNumber}`);
        tempElement.textContent = `Sensor ${index + 1}: ${temp.toFixed(2)} °C`; // Display rounded value
      });
      console.log('Temperatures read successfully:', temperatures);
    } else {
      console.error('No temperature data returned');
    }
  } catch (error) {
    handleError(error, 'Failed to read temperatures:');
  }
}


async function periodicRefresh() {
  // Check if devices are connected and update the UI accordingly
  for (let i = 1; i <= totalDevices; i++) {
    if (await isDeviceConnected(i)) {
      await readTemperatures(i);
    }
  }
}


setInterval(periodicRefresh, 1000);


async function isDeviceConnected(deviceNumber) {
  const serial_number = serialNumberFromDeviceNumber(deviceNumber);
  if (!serial_number) {
    return false;
  }
  try {
    const isConnected = await connectToDevice(serial_number);
    return isConnected;
  } catch (error) {
    console.error(`Error checking connection status for device ${deviceNumber}`, error);
    return false;
  }
}

async function saveLedLayout(deviceNumber) {
  try {
    const selectedPath = await save({
      filters: [{
        name: 'JSON',
        extensions: ['json']
      }]
    });

    // Check if the user selected a path
    if (selectedPath) {
      const serial_number = serialNumberFromDeviceNumber(deviceNumber); // Get the serial number from the device number
      // If user selected a path, save the LED layout to that path
      await invokeTauri('save_led_layout', { serial_number, filename: selectedPath });
      console.log('Layout saved successfully to ' + selectedPath);
    } else {
      console.log('Save operation canceled');
    }
  } catch (error) {
    // Handle the error here
    console.error('An error occurred during the save operation:', error);
  }
}

async function loadLedLayout(deviceNumber) {
  // Open file selection dialog to let the user choose which layout to load
  const selectedPath = await open({
    filters: [{
      name: 'JSON',
      extensions: ['json']
    }]
  });

  if (Array.isArray(selectedPath)) {
    // User selected multiple files, handle this case if applicable
    console.error('Multiple selection is not supported for loading layout.');
  } else if (selectedPath === null) {
    // User cancelled the selection
    console.log('Load operation canceled');
  } else {
    // User selected a single file
    try {
      const serial_number = serialNumberFromDeviceNumber(deviceNumber); // Get the serial number from the device number
      // Invoke the 'load_led_layout' command from the Rust backend
      const ledValues = await invoke('load_led_layout', { serial_number, filename: selectedPath });
      // Process the loaded values (same as before)
      if (ledValues) {
        // Go through the LED elements and update their colors.
        for (let col = 0; col < 22; col++) {
          for (let row = 0; row < 8; row++) {
            let index = calculateLedIndex(row, col, 22, 8);
            const led = document.querySelector(`.led[data-index="${index}"]`);
            const g = ledValues[index * 3];
            const r = ledValues[index * 3 + 1];
            const b = ledValues[index * 3 + 2];
            const color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
            led.style.backgroundColor = color;
            // Update active status and glow if necessary.
            if (r !== 0 || g !== 0 || b !== 0) {
              led.classList.add('active');
              led.style.setProperty('--led-glow-color', color);
            } else {
              led.classList.remove('active');
            }
          }
        }
        console.log('Layout loaded successfully');
      } else {
        console.error('No layout data returned');
      }
      console.log('Layout loaded successfully from ' + selectedPath);
    } catch (error) {
      console.error('Failed to load layout:', error);
    }
  }
}


function createLedMatrix(deviceNumber) {
  const ledMatrix = getElementById(`led-matrix-${deviceNumber}`);
  // Assuming the width (columns) is 22 and the height (rows) is 8.
  const width = 22;
  const height = 8;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      let index = calculateLedIndex(row, col, width, height);
      const led = document.createElement('div');
      led.classList.add('led');
      led.dataset.index = index;
      ledMatrix.appendChild(led);
      led.addEventListener('mousedown', () => handleLedMouseDown(deviceNumber, index));
      led.addEventListener('mouseover', () => handleLedMouseOver(deviceNumber, index));
      addEventListener(led, 'click', () => updateLedColor(deviceNumber, index));
    }
  }

  document.addEventListener('mouseup', handleMouseUp);
}


// Create a dynamic device list and content windows
function createDevices(deviceCount) {
  // Clear existing devices
  const deviceList = document.querySelector('.sidebar-menu');
  const sidebarItem = deviceList.querySelector('.sidebar-item');
  sidebarItem.innerHTML = 'Devices';
  
  const content = document.querySelector('.content');
  
  // Remove all existing device-specific content
  let existingWindows = content.querySelectorAll('.window:not(#settings-window)');
  existingWindows.forEach(win => win.remove());

  for (let i = 1; i <= deviceCount; i++) {
    // Add a sidebar button for each device
    const button = document.createElement('button');
    button.className = 'sidebar-link';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'sidebar-icon';
    iconSpan.textContent = '🏠';

    const textSpan = document.createElement('span');
    textSpan.className = 'sidebar-text';
    textSpan.textContent = `Device ${i}`;

    button.appendChild(iconSpan);
    button.appendChild(textSpan);

    button.dataset.target = `device-window-${i}`;
    sidebarItem.appendChild(button);

    // Create a device window for each device
    const deviceWindow = createDeviceWindow(i);
    content.appendChild(deviceWindow);

    currentToolPerDevice[i] = 'pencil';
  }
  
  // Set event listeners for newly created sidebar links
  document.querySelectorAll('.sidebar-link').forEach(setSidebarLinkEventListener);
}


// Create a new device window
function createDeviceWindow(deviceNumber) {
  const template = document.createElement('template');
  template.innerHTML = `
    <div id="device-window-${deviceNumber}" class="window hidden">
      <h1>PCIe RGB LED Control - Device ${deviceNumber}</h1>
      <div id="led-matrix-overlay">
        <div id="led-matrix-${deviceNumber}" class="led-matrix"></div>
        <img src="assets/PCIeRenderHoles.png" alt="LED Overlay" id="overlay-image" />
      </div>
      <label for="color-picker-${deviceNumber}">Color picker:</label>
      <input type="color" id="color-picker-${deviceNumber}" class="color-picker">
      <button id="pencil-tool-${deviceNumber}" class="selected-tool">Pencil</button>
      <button id="eraser-tool-${deviceNumber}">Eraser</button>
      <button id="clear-board-${deviceNumber}">Clear Board</button>
      <button id="load-image-device-${deviceNumber}" class="load-image-button">Load Image</button>
      <div></div>
      <button id="save-layout-${deviceNumber}">Save Layout</button>
      <button id="load-layout-${deviceNumber}">Load Layout</button>
      <button id="read-temps-${deviceNumber}">Read Temperatures</button>
      <div id="temperature-sensor-0-${deviceNumber}">Sensor 1: -- °C</div>
      <div id="temperature-sensor-1-${deviceNumber}">Sensor 2: -- °C</div>
      <div id="temperature-sensor-2-${deviceNumber}">Sensor 3: -- °C</div>
      <div id="temperature-sensor-3-${deviceNumber}">Sensor 4: -- °C</div>
      <h1>Settings</h1>
      <button id="update-firmware-${deviceNumber}">Update Firmware</button>
      <div id="device-status-${deviceNumber}">Device Status: <span>Unknown</span></div>
    </div>
  `.trim();
  const deviceWindow = template.content.firstChild;

  const loadImageButton = deviceWindow.querySelector(`#load-image-device-${deviceNumber}`);
  loadImageButton.addEventListener('click', () => loadImageAndDisplay(deviceNumber));



  return deviceWindow;
}


// Event listener for sidebar link
function setSidebarLinkEventListener(button) {
  button.addEventListener('click', () => {
    const targetId = button.getAttribute('data-target');

    document.querySelectorAll('.window').forEach(window => {
      if (window.id === targetId) {
        window.classList.remove('hidden');
        window.classList.add('active');
      } else {
        window.classList.add('hidden');
        window.classList.remove('active');
      }
    });
  });
}




// Initialize device count from the settings and then create all devices and their matrices
let deviceCount = parseInt(document.getElementById('device-count').value, 10);

document.addEventListener('DOMContentLoaded', async () => {
  await refreshDeviceList();

  createDeviceUI(totalDevices);

});

async function clearBoard(deviceNumber) {
  const leds = document.querySelectorAll(`#led-matrix-${deviceNumber} .led`);
  leds.forEach(led => {
    led.style.backgroundColor = '#000000';
    led.classList.remove('active');
  });

  // add rust clear
  const serial_number = serialNumberFromDeviceNumber(deviceNumber); // Get the serial number from the device number
  await invokeTauri('clear_board', { serial_number });
}


function setupTestingDeviceButtonEventListeners(deviceNumber) {

  setFriendlyNameAndRegister("12345", "testing", 1);

  const saveButton = document.getElementById(`save-layout-${deviceNumber}`);
  saveButton.addEventListener('click', async () => {
    await saveLedLayout(deviceNumber);
  });

  const loadButton = document.getElementById(`load-layout-${deviceNumber}`);
  loadButton.addEventListener('click', async () => {
    await loadLedLayout(deviceNumber);
  });

  const tempButton = document.getElementById(`read-temps-${deviceNumber}`);
  tempButton.addEventListener('click', async () => {
    await readTemperatures(deviceNumber); // Call your new function
  });

  const updateFirmwareButton = document.getElementById(`update-firmware-${deviceNumber}`);
  updateFirmwareButton.addEventListener('click', async () => {
    try {
      await invokeTauri('update_firmware', {serial_number});
      alert('Firmware updated successfully!');
    } catch (error) {
      handleError(error, 'Error updating firmware:');
      alert('Failed to update firmware.');
    }
  });


  const clearBoardButton = document.getElementById(`clear-board-${deviceNumber}`);
  clearBoardButton.addEventListener('click', () => clearBoard(deviceNumber));

  const pencilButton = document.getElementById(`pencil-tool-${deviceNumber}`);
  pencilButton.addEventListener('click', () => selectTool(deviceNumber, 'pencil'));

  const eraserButton = document.getElementById(`eraser-tool-${deviceNumber}`);
  eraserButton.addEventListener('click', () => selectTool(deviceNumber, 'eraser'));



}

async function createDeviceUI(deviceCount) {
  createDevices(deviceCount); // Devices and related windows will be created here

  // Check for and set up all devices
  for (let i = 1; i <= deviceCount; i++) {
    createLedMatrix(i);
    setupDeviceButtonEventListeners(i);
  }

  // const testingDeviceNumber = deviceCount + 1; // The testing device has the next number
  // createLedMatrix(testingDeviceNumber);
  // setupTestingDeviceButtonEventListeners(testingDeviceNumber);
}



function selectTool(deviceNumber, toolName) {
  currentToolPerDevice[deviceNumber] = toolName;

  const pencilButton = document.getElementById(`pencil-tool-${deviceNumber}`);
  const eraserButton = document.getElementById(`eraser-tool-${deviceNumber}`);
  
  if (toolName === 'pencil') {
    pencilButton.classList.add('selected-tool');
    eraserButton.classList.remove('selected-tool');
  } else {
    eraserButton.classList.add('selected-tool');
    pencilButton.classList.remove('selected-tool');
  }
}




document.getElementById('refresh-devices').addEventListener('click', async () => {
  try {
    const devices = await invokeTauri('find_devices');
    console.log('Found devices:', devices);

    // TODO: Update UI with the list of devices found.
    // You can use the information to create new device entries in the UI or update existing ones.

  } catch (error) {
    handleError(error, 'Error refreshing device list:');
  }
});


addEventListener(toggleButton, 'click', () => {
  toggleClass(sidebar, 'collapsed');
  toggleClass(content, 'shifted');
});


async function loadImageAndDisplay(deviceNumber) {
  // Use a file input dialog to select an image file
  const selectedFilePath = await open({
    filters: [
      // Filter to show only image files
      {
        name: "Images",
        extensions: ['jpg', 'jpeg', 'png', 'bmp', 'gif']
      }
    ]
  });

  // User might cancel the dialog
  if (!selectedFilePath) {
    console.log("No file selected.");
    return;
  }

  // Single or multiple selection might be returned based on configuration
  const file_path = Array.isArray(selectedFilePath) ? selectedFilePath[0] : selectedFilePath;

  const width = 22; // Width of the LED matrix
  const height = 8;  // Height of the LED matrix
  try {
    const serial_number = serialNumberFromDeviceNumber(deviceNumber); // Get the serial number from the device number
    var testing = false;
    if(serial_number==="12345") {
      testing = true;
    }
    const res = await invoke('process_image', { serial_number, file_path, width, height, testing}); // Same as before
    const ledMatrixSelector = `#led-matrix-${deviceNumber} .led`;
    const ledData = res;
    if (ledData) {
      console.log('LED data:', ledData);
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          const linearIndex = row * width + col; // Get the linear index of the image pixel
          const color = ledData[linearIndex]; // Use the linear index to get the color
          const hexColor = `#${color.r.toString(16).padStart(2, '0')}${color.g.toString(16).padStart(2, '0')}${color.b.toString(16).padStart(2, '0')}`;
          const ledElement = document.querySelector(`${ledMatrixSelector}[data-index="${linearIndex}"]`);
          if (ledElement) {
            ledElement.style.backgroundColor = hexColor;
            if (hexColor !== '#000000') {
              ledElement.classList.add('active');
              ledElement.style.setProperty('--led-glow-color', hexColor);
            } else {
              ledElement.classList.remove('active');
            }          
          }
        }
      }
    }
  } catch (error) {
    console.error("Error loading or processing image:", error);
  }
}

document.querySelectorAll('.sidebar-link').forEach(button => {
  addEventListener(button, 'click', () => {
    const targetId = button.getAttribute('data-target');

    document.querySelectorAll('.window').forEach(window => {
      if (window.id === targetId) {
        removeClass(window, 'hidden');
        addClass(window, 'active');
      } else {
        addClass(window, 'hidden');
        removeClass(window, 'active');
      }
    });
  });
});





/* led matrix related stuff */
function handleLedMouseDown(deviceNumber, index) {
  isMouseDown = true;
  updateLedColor(deviceNumber, index);
}

function handleLedMouseOver(deviceNumber, index) {
  if (isMouseDown) {
    updateLedColor(deviceNumber, index);
  }
}

function handleMouseUp() {
  isMouseDown = false;
}

async function updateLedColor(deviceNumber, index) {
  const led = document.querySelector(`#led-matrix-${deviceNumber} .led[data-index="${index}"]`);
  let color;

  if (currentToolPerDevice[deviceNumber] === 'pencil') {
    const colorPicker = document.getElementById(`color-picker-${deviceNumber}`);
    color = colorPicker.value;
  } else if (currentToolPerDevice[deviceNumber] === 'eraser') {
    color = '#000000';
  }

  led.style.backgroundColor = color;

  const r = parseInt(color.substr(1, 2), 16);
  const g = parseInt(color.substr(3, 2), 16);
  const b = parseInt(color.substr(5, 2), 16);

  const led_color = {
    index: index,
    color: { r, g, b }
  };

  if (color !== '#000000') {
    led.classList.add('active');
    led.style.setProperty('--led-glow-color', color); // Set the glow color
  } else {
    led.classList.remove('active');
  }
  const serial_number = serialNumberFromDeviceNumber(deviceNumber); // Get the serial number from the device number

  await invokeTauri('update_led_color', { serial_number, led_color });
}

// New helper function for setting up each device's button event listeners
function setupDeviceButtonEventListeners(deviceNumber) {
  const saveButton = document.getElementById(`save-layout-${deviceNumber}`);
  saveButton.addEventListener('click', async () => {
    await saveLedLayout(deviceNumber);
  });

  const loadButton = document.getElementById(`load-layout-${deviceNumber}`);
  loadButton.addEventListener('click', async () => {
    await loadLedLayout(deviceNumber);
  });

  const tempButton = document.getElementById(`read-temps-${deviceNumber}`);
  tempButton.addEventListener('click', async () => {
    await readTemperatures(deviceNumber); // Call your new function
  });

  const updateFirmwareButton = document.getElementById(`update-firmware-${deviceNumber}`);
  updateFirmwareButton.addEventListener('click', async () => {
    try {
      await invokeTauri('update_firmware', {serial_number});
      alert('Firmware updated successfully!');
    } catch (error) {
      handleError(error, 'Error updating firmware:');
      alert('Failed to update firmware.');
    }
  });


  const clearBoardButton = document.getElementById(`clear-board-${deviceNumber}`);
  clearBoardButton.addEventListener('click', () => clearBoard(deviceNumber));

  const pencilButton = document.getElementById(`pencil-tool-${deviceNumber}`);
  pencilButton.addEventListener('click', () => selectTool(deviceNumber, 'pencil'));

  const eraserButton = document.getElementById(`eraser-tool-${deviceNumber}`);
  eraserButton.addEventListener('click', () => selectTool(deviceNumber, 'eraser'));

  
  
  // async function updateDeviceStatus() {
  //   try {
  //     const status = await invokeTauri('get_device_status', {serial_number});
  //     getElementById('status-display').textContent = status ? 'Connected' : 'Disconnected';
  //   } catch (error) {
  //     handleError(error, 'Error getting device status:');
  //   }
  // }
  

}

/* device related stuff */
const deviceList = getElementById('device-list');
// const deviceListItems = deviceList.querySelectorAll('li');


async function setFriendlyNameAndRegister(serialNumber, friendlyName, deviceNumber) {
  try {
    await invokeTauri('set_friendly_name', { serial_number: serialNumber, friendly_name: friendlyName });
    console.log(`Friendly name ${friendlyName} set for device with serial number ${serialNumber}.`);
    // Update the JavaScript mapping with the new friendly name and device association.
    registerDevice(deviceNumber, { serialNumber, friendlyName });
    console.log(deviceMapping); // Debug: view the updated mapping
  } catch (error) {
    handleError(error, 'Failed to set friendly name.');
  }
}


function serialNumberFromDeviceNumber(deviceNumber) {
  const deviceInfo = deviceMapping[deviceNumber];
  if (deviceInfo) {
    return deviceInfo.serialNumber;
  } else {
    console.warn(`No device found for device number ${deviceNumber}.`);
    return null;
  }
}

async function refreshDeviceList() {
  try {
    const devices = await invokeTauri('find_devices');
    deviceList.innerHTML = ''; // Clear the current list
    totalDevices = 0;

    devices.forEach(([manufacturer, product, serial]) => {
      totalDevices++;
      const listItem = document.createElement('li');
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.placeholder = 'Enter friendly name';

      const devNumberInput = document.createElement('input');
      devNumberInput.type = 'text';
      devNumberInput.placeholder = 'Enter device number';
      
      const connectButton = document.createElement('button');
      connectButton.textContent = 'Connect';
      connectButton.onclick = async () => {
        const friendlyName = nameInput.value.trim();
        const deviceNumber = devNumberInput.value.trim();
        if (friendlyName) {
          // Set friendly name and connect to the device
          setFriendlyNameAndRegister(serial, friendlyName, deviceNumber);
          //await invokeTauri('set_friendly_name', { serial_number: serial, friendly_name: friendlyName });
          await invokeTauri('connect_to_device', { serial_number: serial });
          alert(`Connected to ${friendlyName}!`);
        } else {
          alert('Please enter a friendly name.');
        }
      };

      listItem.innerHTML = `${manufacturer} ${product} (Serial: ${serial}) `;
      listItem.appendChild(nameInput);
      listItem.appendChild(devNumberInput);
      listItem.appendChild(connectButton);

      deviceList.appendChild(listItem);
    });

  } catch (error) {
    handleError(error, 'Error refreshing device list:');
  }
}


async function connectToDevice(serial_number) {
  return await invokeTauri('connect_to_device', { serial_number });
}



// deviceListItems.forEach(item => {
//   addEventListener(item, 'click', async () => {
//     const device = item.textContent;
//     await updateDeviceColor(device, '#000000');
//     const selectedDevice = deviceList.querySelector('.selected');
//     if (selectedDevice) {
//       removeClass(selectedDevice, 'selected');
//     }
//     addClass(item, 'selected');
//   });
// });




//updateDeviceStatus();
