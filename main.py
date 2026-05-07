import machine
import utime
import math
import json

# --- AJUSTES ---
URL_GOOGLE = "https://script.google.com/macros/s/TU_ID_DE_SCRIPT/exec"
APN = "bam.entelpcs.cl"

# --- HARDWARE ---
uart = machine.UART(2, baudrate=115200, tx=17, rx=16, timeout=2000)
adc = machine.ADC(machine.Pin(32))
adc.atten(machine.ADC.ATTN_11DB)

def enviar_at(comando, espera=2000):
    while uart.any(): uart.read()
    uart.write(comando + '\r\n')
    utime.sleep_ms(espera)
    if uart.any():
        return uart.read().decode('utf-8', 'ignore')
    return ""

def preparar_modem():
    print(">>> Forzando conexión de datos...")
    enviar_at('ATE0')
    enviar_at('AT+HTTPTERM')
    # Esto asegura que el módem busque la red antes de intentar el HTTP
    enviar_at('AT+CREG?') # Revisa registro en red
    enviar_at('AT+CGATT=1') # Fuerza el acople GPRS
    enviar_at('AT+SAPBR=3,1,"APN","' + APN + '"')
    enviar_at('AT+SAPBR=1,1')
    enviar_at('AT+HTTPSSL=1')
    enviar_at('AT+CGPS=1')

def obtener_hora():
    res = enviar_at('AT+CCLK?')
    if "+CCLK: " in res:
        try:
            # Retorna algo como "26/05/06,09:30:15-16"
            return res.split('"')[1].split("-")[0]
        except: return "Hora no disp."
    return "Buscando red..."

def calcular_corriente():
    # 1. Calibración dinámica del "Cero"
    # Tomamos 100 lecturas rápidas para ver dónde está el nodo central REAL ahora
    v_centro_real = 0
    for _ in range(100):
        v_centro_real += (adc.read() * 3.6) / 4095
    offset = v_centro_real / 100
    
    # 2. Medición de Corriente con el offset real
    muestras = 500
    suma_cuadrados = 0
    for _ in range(muestras):
        v = (adc.read() * 3.6) / 4095
        # Restamos el centro real calculado arriba, no un número fijo
        val = v - offset 
        suma_cuadrados += val ** 2
    
    corriente_rms = math.sqrt(suma_cuadrados / muestras) * 30
    
    # 3. Filtro de Ruido (Deadzone)
    # Si la lectura es muy baja, es basura eléctrica del módem. Forzamos a 0.
    if corriente_rms < 1.8: 
        return 0.0
        
    return corriente_rms

def obtener_gps():
    res = enviar_at('AT+CGPSINFO')
    if "+CGPSINFO: " in res and ",,," not in res:
        try:
            raw = res.split("+CGPSINFO: ")[1].split("\r")[0].split(",")
            lat_v = float(raw[0])
            lat = (lat_v // 100) + (lat_v % 100) / 60
            if raw[1] == 'S': lat = -lat
            lon_v = float(raw[2])
            lon = (lon_v // 100) + (lon_v % 100) / 60
            if raw[3] == 'W': lon = -lon
            return round(lat, 6), round(lon, 6)
        except: return 0.0, 0.0
    return 0.0, 0.0

def transmitir(amp, lat, lon):
    # El diccionario se abre y se cierra AQUÍ
    payload = json.dumps({
        "dispositivo_id": "Dinamo_01",
        "corriente": round(amp, 2),
        "lat": lat,
        "lon": lon,
        "potencia_kw": round((amp * 220) / 1000, 3)
    }) 

    # Ahora sí vienen los comandos, FUERA de las llaves
    enviar_at('AT+HTTPINIT')
    enviar_at('AT+HTTPPARA="URL","' + URL_GOOGLE + '"')
    enviar_at('AT+HTTPPARA="CONTENT","application/json"')
    
    res_data = enviar_at('AT+HTTPDATA=' + str(len(payload)) + ',5000')
    if "DOWNLOAD" in res_data:
        uart.write(payload)
        utime.sleep_ms(500)
    
    # Aquí es donde va el debug que querías ver
    res_action = enviar_at('AT+HTTPACTION=1', espera=8000)
    print("DEBUG MÓDEM: " + res_action.strip()) 
    
    enviar_at('AT+HTTPTERM')
    return res_action

# --- BUCLE PRINCIPAL ---
preparar_modem()

print("\n" + "="*40)
print(" SISTEMA DE MONITOREO DÍNAMO ")
print("="*40 + "\n")

while True:
    try:
        # 1. Obtener Datos
        hora = obtener_hora()
        amp = calcular_corriente()
        lat, lon = obtener_gps()
        
        # 2. Mostrar en Consola (Pragmático)
        print("-" * 40)
        print("HORA:      {}".format(hora))
        print("AMPERAJE:  {:.2f} A".format(amp))
        print("UBICACIÓN: {}, {}".format(lat, lon))
        print("POTENCIA:  {:.3f} kW".format((amp * 220) / 1000))
        
        # 3. Transmitir
        print("ESTADO:    Transmitiendo a Google...", end="")
        res = transmitir(amp, lat, lon)
        
        if "1,200" in res or "1,302" in res:
            print(" [OK]")
        else:
            print(" [FALLÓ]")
        
        print("-" * 40)
        
        # 4. Espera
        utime.sleep(60)
        
    except Exception as e:
        print("\n[!] Error en el ciclo: {}".format(e))
        utime.sleep(10)