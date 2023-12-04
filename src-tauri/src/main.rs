#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use image::{GenericImageView};
use rusb::{DeviceHandle, GlobalContext};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use std::{fs::File, io::prelude::*};
use tauri::command;
use std::collections::HashMap;

const VENDOR_ID: u16 = 0x2E8A;
const PRODUCT_ID: u16 = 0x000a;
const MANUFACTURER_STRING: &str = "Raspberry Pi";
const PRODUCT_STRING: &str = "Pico";

const REQ_SET_LED: u8 = 0x01;
const REQ_GET_TEMPERATURE: u8 = 0x02;

const GAMMA_LUT: [u8; 256] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5,
    5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12, 13, 13, 13, 14,
    14, 15, 15, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 24, 24, 25, 25, 26, 27,
    27, 28, 29, 29, 30, 31, 32, 32, 33, 34, 35, 35, 36, 37, 38, 39, 39, 40, 41, 42, 43, 44, 45, 46,
    47, 48, 49, 50, 50, 51, 52, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 66, 67, 68, 69, 70, 72,
    73, 74, 75, 77, 78, 79, 81, 82, 83, 85, 86, 87, 89, 90, 92, 93, 95, 96, 98, 99, 101, 102, 104,
    105, 107, 109, 110, 112, 114, 115, 117, 119, 120, 122, 124, 126, 127, 129, 131, 133, 135, 137,
    138, 140, 142, 144, 146, 148, 150, 152, 154, 156, 158, 160, 162, 164, 167, 169, 171, 173, 175,
    177, 180, 182, 184, 186, 189, 191, 193, 196, 198, 200, 203, 205, 208, 210, 213, 215, 218, 220,
    223, 225, 228, 231, 233, 236, 239, 241, 244, 247, 249, 252, 255,
];

#[derive(Serialize, Deserialize, Clone, Copy)]
struct Rgb {
    r: u8,
    g: u8,
    b: u8,
}

#[derive(Serialize, Deserialize)]
struct LedColor {
    index: usize,
    color: Rgb,
}

const WIDTH: usize = 22;
const HEIGHT: usize = 8;

const LED_BUFFER_SIZE: usize = WIDTH * HEIGHT * 3;

use std::sync::Mutex;
lazy_static::lazy_static! {
    static ref LED_BUFFERS: Mutex<HashMap<String, [u8; LED_BUFFER_SIZE]>> = Mutex::new(HashMap::new());
    static ref DEVICE_HANDLES: Mutex<HashMap<String, DeviceHandle<GlobalContext>>> = Mutex::new(HashMap::new());
    static ref FRIENDLY_NAMES: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
}

#[tauri::command(rename_all = "snake_case")]
fn set_friendly_name(serial_number: String, friendly_name: String) -> Result<(), String> {
    let mut friendly_names = FRIENDLY_NAMES.lock().map_err(|e| e.to_string())?;
    friendly_names.insert(serial_number, friendly_name);
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
fn get_friendly_names() -> Result<HashMap<String, String>, String> {
    let friendly_names = FRIENDLY_NAMES.lock().map_err(|e| e.to_string())?;
    Ok(friendly_names.clone())
}

fn calculate_led_index(row: usize, col: usize, height: usize) -> usize {
    // Determine if the current column is going upwards or downwards.
    let is_going_up = col % 2 == 0;
    // Since in the software, the top left is addressed but it needs to address the bottom left,
    // you need to reverse the row index by subtracting from the maximum index (height - 1).
    let adjusted_row = (height - 1) - row;
    // Calculate the index based on whether it's going up or down.
    if is_going_up {
        col * height + adjusted_row
    } else {
        col * height + row
    }
}


#[command]
fn find_devices() -> Result<Vec<(String, String, String)>, String> {
    let mut devices_info = Vec::new();

    for device in rusb::devices().map_err(|e| e.to_string())?.iter() {
        let device_desc = device.device_descriptor().map_err(|e| e.to_string())?;

        if device_desc.vendor_id() == VENDOR_ID && device_desc.product_id() == PRODUCT_ID {
            let device_handle = match device.open() {
                Ok(handle) => handle,
                Err(e) => {
                    eprintln!("Error opening device: {}", e);
                    continue;
                }
            };

            let manufacturer_string =
                match device_handle.read_manufacturer_string_ascii(&device_desc) {
                    Ok(manufacturer) => manufacturer,
                    Err(_) => continue,
                };
            let product_string = match device_handle.read_product_string_ascii(&device_desc) {
                Ok(product) => product,
                Err(_) => continue,
            };

            let serial_number_string = match device_handle.read_serial_number_string_ascii(&device_desc) {
                Ok(serial_number) => serial_number,
                Err(_) => continue,
            };


            if manufacturer_string == MANUFACTURER_STRING && product_string == PRODUCT_STRING {
                devices_info.push((manufacturer_string, product_string, serial_number_string));
            }
        }
    }

    Ok(devices_info)
}


#[tauri::command(rename_all = "snake_case")]
fn connect_to_device(serial_number: &str) -> Result<bool, String> {
    let mut device_handles = DEVICE_HANDLES.lock().map_err(|e| e.to_string())?;

    // Check if handle already exists
    if let Some(device_handle) = device_handles.get(serial_number) {
        // Simple check if the handle is valid
        if device_handle.kernel_driver_active(0).is_ok() {
            // Device handle is valid
            return Ok(true);
        } else {
            // Device handle became invalid (device disconnected)
            device_handles.remove(serial_number);

            // Could remove the buffer here too, I think it's better to keep it though for a reconnect
            //LED_BUFFERS.lock().map_err(|e| e.to_string())?.remove(serial_number);
        }
    }
    
    // No device handle OR the handle was invalid.
    // Enumerate rusb::devices and try to reconnect.

    let devices = rusb::devices().map_err(|e| e.to_string())?;
    for device in devices.iter() {
        let device_desc = device.device_descriptor().map_err(|e| e.to_string())?;

        if device_desc.vendor_id() == VENDOR_ID && device_desc.product_id() == PRODUCT_ID {
            match device.open() {
                Ok(temp_device_handle) => {
                    // Check against serial number
                    match temp_device_handle.read_serial_number_string_ascii(&device_desc) {
                        Ok(temp_serial_number) if temp_serial_number == serial_number => {
                            // Found device by serial number, store the handle
                            device_handles.insert(serial_number.to_string(), temp_device_handle);
                            let mut buffers = LED_BUFFERS.lock().map_err(|e| e.to_string())?;
                            // Ensure buffer exists when connecting to device
                            buffers.entry(serial_number.to_string()).or_insert_with(|| [0; LED_BUFFER_SIZE]);
                            return Ok(true);
                        },
                        _ => continue // Incorrect device, continue searching
                    }
                },
                Err(_) => continue // Couldn't open device, continue searching
            }
        }
    }
    
    // Something really messed up, return an error
    Err("Device with the specified serial number not found".to_string())
}

#[tauri::command(rename_all = "snake_case")]
fn update_led_color(serial_number: String, led_color: LedColor) -> Result<(), String> {
    let mut buffers = LED_BUFFERS.lock().unwrap();
    let led_buffer = buffers.get_mut(&serial_number).ok_or_else(|| "Buffer for device not found".to_string())?;
    let index = led_color.index;
    let base = index * 3; // Each LED has 3 bytes (GRB)

    // Update LED color in the buffer
    led_buffer[base] = led_color.color.g;
    led_buffer[base + 1] = led_color.color.r;
    led_buffer[base + 2] = led_color.color.b;

    // Retrieve stored device handle from the global mutex
    

    with_device_handle(&serial_number, |device_handle| {
        // Send updated buffer to the device
        device_handle
            .write_control(
                rusb::request_type(
                    rusb::Direction::Out,
                    rusb::RequestType::Vendor,
                    rusb::Recipient::Device,
                ),
                REQ_SET_LED,
                0,
                0,
                &*led_buffer,
                Duration::from_secs_f32(1.0),
            )
            .map_err(|e| e.to_string())?;
        Ok(())

    })

}

#[tauri::command(rename_all = "snake_case")]
fn update_led_buffer(serial_number: String, led_colors: &[Rgb]) -> Result<(), String> {
    // Make sure we have the correct number of LED colors
    if led_colors.len() != WIDTH * HEIGHT {
        return Err("Incorrect number of LED colors provided".to_string());
    }

    let mut buffers = LED_BUFFERS.lock().unwrap();
    let led_buffer = buffers.get_mut(&serial_number).ok_or_else(|| "Buffer for device not found".to_string())?;

    // Convert and copy the received colors into the LED buffer
    for (index, color) in led_colors.iter().enumerate() {
        let base = index * 3;
        led_buffer[base] = color.g;
        led_buffer[base + 1] = color.r;
        led_buffer[base + 2] = color.b;
    }

    // Retrieve stored device handle from the global mutex
    with_device_handle(&serial_number, |device_handle| {
        // Send the updated buffer to the device
        device_handle
            .write_control(
                rusb::request_type(
                    rusb::Direction::Out,
                    rusb::RequestType::Vendor,
                    rusb::Recipient::Device,
                ),
                REQ_SET_LED,
                0,
                0,
                &*led_buffer,
                Duration::from_secs_f32(1.0),
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    })

}

#[command]
fn update_firmware() -> Result<(), &'static str> {
    Err("Firmware update not implemented")
}

#[command]
fn get_device_status() -> Result<bool, &'static str> {
    Err("Device status retrieval not implemented")
}

#[tauri::command(rename_all = "snake_case")]
fn save_led_layout(serial_number: String, filename: &str) -> Result<(), String> {
    let mut buffers = LED_BUFFERS.lock().unwrap();
    let led_buffer = buffers.get_mut(&serial_number).ok_or_else(|| "Buffer for device not found".to_string())?;
    let json = serde_json::to_string(&(*led_buffer).to_vec()).map_err(|e| e.to_string())?;
    let mut file = File::create(filename).map_err(|e| e.to_string())?;
    file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
fn load_led_layout(serial_number: String, filename: &str) -> Result<Vec<u8>, String> {
    let mut file = File::open(filename).map_err(|e| e.to_string())?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)
        .map_err(|e| e.to_string())?;
    let led_values: Vec<u8> = serde_json::from_str(&contents).map_err(|e| e.to_string())?;

    if led_values.len() == LED_BUFFER_SIZE {
        let mut buffers = LED_BUFFERS.lock().unwrap();
        let led_buffer = buffers.get_mut(&serial_number).ok_or_else(|| "Buffer for device not found".to_string())?;
        let led_values_array: [u8; LED_BUFFER_SIZE] = led_values
            .as_slice()
            .try_into()
            .map_err(|e: std::array::TryFromSliceError| e.to_string())?;
        *led_buffer = led_values_array;
        Ok(led_values) // Return the loaded data
    } else {
        Err("Invalid LED data found in the file".to_string())
    }
}

#[tauri::command(rename_all = "snake_case")]
fn get_temperature(serial_number: String) -> Result<[f32; 4], String> {

    with_device_handle(&serial_number, |device_handle| {
        let mut temp_bytes: [u8; 16] = [0; 16]; // 4 floats * 4 bytes/float
        device_handle
            .read_control(
                rusb::request_type(
                    rusb::Direction::In,
                    rusb::RequestType::Vendor,
                    rusb::Recipient::Device,
                ),
                REQ_GET_TEMPERATURE,
                0,
                0,
                &mut temp_bytes,
                Duration::from_secs_f32(1.0),
            )
            .map_err(|e| e.to_string())?;

        // Convert each set of 4 bytes into a f32
        let mut temperatures = [0.0f32; 4];
        for i in 0..4 {
            temperatures[i] = f32::from_le_bytes(temp_bytes[i * 4..i * 4 + 4].try_into().unwrap());
        }
        //print temps
        println!("Temperatures: {:?}", temperatures);

        Ok(temperatures)
    })
}

#[tauri::command(rename_all = "snake_case")]
fn process_image(serial_number:String, file_path: String, width: usize, height: usize) -> Result<Vec<Rgb>, String> {
    let img = match image::open(file_path) {
        Ok(img) => img,
        Err(_) => return Err("Could not open the image file.".to_string()),
    };

    // Resize the image to fit the LED matrix
    let resized_img = img.resize_exact(
        width as u32,
        height as u32,
        image::imageops::FilterType::Triangle,
    );

    // Convert the image to RGB and process its contents to fit our requirements
    // led_data should have 176 elements (22x8)
    let mut led_data: Vec<Rgb> = vec![Rgb { r: 0, g: 0, b: 0 }; width * height];

    // Iterate over pixels and convert to our Rgb struct, adding print statements
    for (x, y, pixel) in resized_img.pixels() {
        let rgb = Rgb {
            r: GAMMA_LUT[pixel[0] as usize],
            g: GAMMA_LUT[pixel[1] as usize],
            b: GAMMA_LUT[pixel[2] as usize],
        };
        // Print the position and color of each pixel
        println!("Pixel at ({}, {}): ({}, {}, {})", x, y, rgb.r, rgb.g, rgb.b);
        //get calculated index
        let index = calculate_led_index(y as usize, x as usize, height);
        led_data[index] = rgb;
    }

    update_led_buffer(serial_number,&led_data).map_err(|e| e.to_string())?;
    Ok(led_data)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            connect_to_device,
            find_devices,
            update_led_color,
            save_led_layout,
            load_led_layout,
            update_firmware,
            get_device_status,
            get_temperature,
            process_image,
            set_friendly_name,
            get_friendly_names
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn with_device_handle<F, T>(
    serial_number: &str,
    f: F,
) -> Result<T, String> 
where
    F: FnOnce(&DeviceHandle<GlobalContext>) -> Result<T, String>,
{
    let device_handles = DEVICE_HANDLES.lock().map_err(|e| e.to_string())?;
    if let Some(device_handle) = device_handles.get(serial_number) {
        f(device_handle)
    } else {
        Err("Device handle not found".to_string())
    }
}

/* TODO:

Auto refresh device list every n seconds if a device is not connected AND/OR if n devices are selected and <n devices are connected
Update layout based on what is on screen without needing an extra click (just call an update function maybe?)
Animations
Sharing
Firmware update

*/
