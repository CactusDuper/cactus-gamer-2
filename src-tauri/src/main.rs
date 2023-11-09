#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use rusb::{DeviceHandle, GlobalContext};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::command;

const VENDOR_ID: u16 = 0x16C0;
const PRODUCT_ID: u16 = 0x05DC;
const MANUFACTURER_STRING: &str = "dutchen18@gmail.com";
const PRODUCT_STRING: &str = "Lights";

#[derive(Serialize, Deserialize)]
struct RGB {
    r: u8,
    g: u8,
    b: u8,
}


#[derive(Serialize, Deserialize)]
struct LedColor {
    index: usize,
    color: RGB,
}


const WIDTH: usize = 24;
const HEIGHT: usize = 8;

const LED_BUFFER_SIZE: usize = WIDTH * HEIGHT * 3;

use std::sync::Mutex;
lazy_static::lazy_static! {
    static ref LED_BUFFER: Mutex<[u8; LED_BUFFER_SIZE]> = Mutex::new([0; LED_BUFFER_SIZE]);
}

#[command]
fn find_device() -> Result<bool, String> {
    for device in rusb::devices().map_err(|e| e.to_string())?.iter() {
        let device_desc = device.device_descriptor().map_err(|e| e.to_string())?;

        if device_desc.vendor_id() == VENDOR_ID && device_desc.product_id() == PRODUCT_ID {
            let device_handle = device.open().map_err(|e| e.to_string())?;

            if device_handle.read_manufacturer_string_ascii(&device_desc).map_err(|e| e.to_string())? == MANUFACTURER_STRING
                && device_handle.read_product_string_ascii(&device_desc).map_err(|e| e.to_string())? == PRODUCT_STRING
            {
                // Store the device handle, im guessing a global mutex or something would be best
                return Ok(true);
            }
        }
    }

    Ok(false)
}

#[command]
fn update_led_color(led_color: LedColor) -> Result<(), String> {
    let mut led_buffer = LED_BUFFER.lock().map_err(|e| e.to_string())?;
    let index = led_color.index;
    let base = index * 3; // Each LED has 3 bytes (GRB)

    // Update LED color in the buffer
    led_buffer[base] = led_color.color.g;
    led_buffer[base + 1] = led_color.color.r;
    led_buffer[base + 2] = led_color.color.b;

    // Retrieve stored device handle from the global mutex (when implemented)
    let device_handle = get_device_handle().map_err(|e| e.to_string())?;

    // Send updated buffer to the device
    device_handle
        .write_control(
            rusb::request_type(
                rusb::Direction::Out,
                rusb::RequestType::Vendor,
                rusb::Recipient::Device,
            ),
            0,
            0,
            0,
            &*led_buffer,
            Duration::from_secs_f32(1.0),
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[command]
fn update_firmware() -> Result<(), &'static str> {
    Err("Firmware update not implemented")
}

#[command]
fn get_device_status() -> Result<bool, &'static str> {
    Err("Device status retrieval not implemented")
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![find_device, update_led_color, update_firmware, get_device_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn get_device_handle() -> Result<DeviceHandle<GlobalContext>, &'static str> {
    Err("Device handle not implemented")
}