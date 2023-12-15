#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "bsp/board.h"
#include "tusb.h"
#include "hardware/pio.h"
#include "hardware/clocks.h"
#include "ws2812.pio.h"
#include "hardware/i2c.h"

#define NUM_PIXELS      (22 * 8)
#define WS2812_PIN      17
#define VENDOR_ID       0x2E8A
#define PRODUCT_ID      0x000a

#define REQ_SET_LED     0x01
#define REQ_GET_TEMPERATURE  0x02

#define TMP102_SDA 18
#define TMP102_SCL 19

#define TMP102_I2C_FREQ 1

#define TMP102_NUM_SENSORS 4
#define TMP102_ADDRESSES {0x48, 0x49, 0x4A, 0x4B} // TMP102 Addresses

#define TEMPERATURE_REGISTER 0x00
#define CONFIG_REGISTER 0x01
#define T_LOW_REGISTER 0x02
#define T_HIGH_REGISTER 0x03

uint8_t led_buffer[NUM_PIXELS * 3];

// Initialize USB stack
void usb_init() {
    tusb_init();
}

// Initialize PIO and WS2812 for LED strip
void ws2812_init() {
    PIO pio = pio0;
    uint sm = 0;
    uint offset = pio_add_program(pio, &ws2812_program);
    ws2812_program_init(pio, sm, offset, WS2812_PIN, 800000, false);
}

// Function to send data to the LED strip
void put_pixel(uint32_t pixel_grb) {
    pio_sm_put_blocking(pio0, 0, pixel_grb << 8u);
}

float temperatures[TMP102_NUM_SENSORS];


void tmp102_init() {
    i2c_init(i2c1, 400000);
    gpio_set_function(TMP102_SDA, GPIO_FUNC_I2C);
    gpio_set_function(TMP102_SCL, GPIO_FUNC_I2C);
    gpio_pull_up(TMP102_SDA);
    gpio_pull_up(TMP102_SCL);
    // Should probably set other default values here to make sure the TMP102 is in a known state
    // However, the startup values seem to always apply properly and the defaults are perfect 
}

float tmp102_read_temperature(uint8_t address) {
    uint8_t buf[2];
    i2c_read_blocking(i2c1, address, (void*)&buf, 2, false);
    int16_t reg = (buf[0]) << 4 | (buf[1] >> 4);
    float temp = reg*0.0625;
    return temp;
}

// USB Vendor Control Transfer Callback
bool tud_vendor_control_xfer_cb(uint8_t rhport, uint8_t stage, tusb_control_request_t const *request) {
    // Handle different stages and request types
    if (stage == CONTROL_STAGE_SETUP) {
        if (request->bmRequestType_bit.type == TUSB_REQ_TYPE_VENDOR) {
            switch (request->bRequest) {
                case REQ_SET_LED:
                    // Prepare the buffer to receive the LED data
                    return tud_control_xfer(rhport, request, led_buffer, sizeof(led_buffer));

                case REQ_GET_TEMPERATURE:
                    // Prepare to send the temperature data back to the host
                    {
                        for (uint8_t i = 0; i < TMP102_NUM_SENSORS; i++) {
                            temperatures[i] = tmp102_read_temperature(0x48 + i);
                        }
                        // Send temperature data as a response
                        tud_control_xfer(rhport, request, temperatures, sizeof(temperatures));
                    }
                    break;
                default:
                    // Unknown request
                    return false;
            }
        }
      } else if (stage == CONTROL_STAGE_ACK) {
        switch (request->bRequest) {
            case REQ_SET_LED:
                // Data has been transferred, update the LEDs
                for (uint i = 0; i < NUM_PIXELS; i++) {
                    // Extract colors and apply to LEDs in RGB format (Comes in as GRB, pio expects RGB)
                    uint32_t rgb = (led_buffer[i * 3 + 1] << 8) | (led_buffer[i * 3] << 16) | led_buffer[i * 3 + 2];
                    put_pixel(rgb); // Update pixel color
                }
                break;
            default:
                // Unknown request
                break;
        }
    }
    return true; // Indicate the request has been handled
}

// Main program
int main() {
    board_init();
    tusb_init();

    // WS2812 initialization
    ws2812_init();

    // Initialize LED buffer
    memset(led_buffer, 0, sizeof(led_buffer));


    tmp102_init();

    // Main loop
    while (1) {
        tud_task(); // Handle USB tasks
    }

    return 0;
}