import hashlib
import os
import secrets
import uuid

from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from database import engine

app = FastAPI(
    title="VeciRed API",
    version="0.2.0"
)

# Almacenamiento de archivos de profesionales
UPLOAD_DIR = Path(__file__).resolve().parent / "uploads" / "profesionales"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB

# Orígenes permitidos, separados por comas. Configurable con CORS_ORIGINS.
CORS_ORIGINS = [
    origen.strip()
    for origen in os.getenv(
        "CORS_ORIGINS", "https://veci-red2-0.vercel.app"
    ).split(",")
    if origen.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ------------------------------------------
# Modelo de datos para registrar un vecino
# ------------------------------------------


class RegistroVecino(BaseModel):
    nombre: str = Field(min_length=1, max_length=150)
    correo: str = Field(
        min_length=5,
        max_length=150,
        pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    )
    telefono: str = Field(min_length=1, max_length=20)
    password: str = Field(min_length=1, max_length=128)

    direccion: str = Field(min_length=1, max_length=255)
    barrio: str = Field(min_length=1, max_length=100)
    depto: str | None = Field(default=None, max_length=100)


class RegistroProfesional(BaseModel):
    nombre: str = Field(min_length=1, max_length=150)
    correo: str = Field(min_length=5, max_length=150)
    telefono: str = Field(min_length=1, max_length=20)
    password: str = Field(min_length=1, max_length=128)

    direccion: str = Field(min_length=1, max_length=255)
    barrio: str = Field(min_length=1, max_length=100)
    depto: str | None = Field(default=None, max_length=100)

    tipo_profesional: str = Field(pattern=r"^(certificado|experiencia)$")
    especialidad: str = Field(min_length=1, max_length=100)
    rut: str = Field(min_length=1, max_length=12)

    tipo_comprobante: str | None = None
    institucion: str | None = None
    registro_publico: str | None = None

    anos_experiencia: str | None = Field(default=None, max_length=30)

    ref1_nombre: str | None = None
    ref1_contacto: str | None = None
    ref1_trabajo: str | None = None
    ref2_nombre: str | None = None
    ref2_contacto: str | None = None
    ref2_trabajo: str | None = None
    portafolio: str | None = None


class InicioSesion(BaseModel):
    identificador: str = Field(min_length=1, max_length=150)
    password: str = Field(min_length=1, max_length=128)


# ------------------------------------------
# Protección de contraseñas
# ------------------------------------------


def generar_hash(password: str) -> str:
    salt = secrets.token_bytes(16)

    hash_password = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=2**14,
        r=8,
        p=1,
        dklen=32
    )

    return (
        f"scrypt${salt.hex()}${hash_password.hex()}"
    )


def verificar_password(password: str, password_guardada: str) -> bool:
    try:
        algoritmo, salt_hex, hash_hex = password_guardada.split("$", 2)

        if algoritmo != "scrypt":
            return False

        salt = bytes.fromhex(salt_hex)
        hash_esperado = bytes.fromhex(hash_hex)

        hash_calculado = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=2**14,
            r=8,
            p=1,
            dklen=len(hash_esperado)
        )

        return secrets.compare_digest(hash_calculado, hash_esperado)

    except (ValueError, TypeError):
        return False

# ------------------------------------------
# Página principal
# ------------------------------------------


@app.get("/")
def inicio():
    return {
        "mensaje": "Backend de VeciRed funcionando"
    }


# ------------------------------------------
# Comprobar conexión con MariaDB
# ------------------------------------------

@app.get("/health/db")
def comprobar_base_datos():
    try:
        with engine.connect() as conexion:
            nombre = conexion.execute(
                text("SELECT DATABASE()")
            ).scalar_one()

        return {
            "estado": "conectado",
            "base_de_datos": nombre
        }

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail="No se pudo conectar con MariaDB"
        ) from error


# ------------------------------------------
# Registrar vecino
# ------------------------------------------

@app.post("/registro/vecino", status_code=201)
def registrar_vecino(datos: RegistroVecino):

    try:
        password_hash = generar_hash(datos.password)

        with engine.begin() as conexion:

            # 1. Crear usuario
            resultado = conexion.execute(
                text("""
                    INSERT INTO usuarios (
                        nombre,
                        correo,
                        telefono,
                        contrasena_hash,
                        rol
                    )
                    VALUES (
                        :nombre,
                        :correo,
                        :telefono,
                        :password_hash,
                        'vecino'
                    )
                """),
                {
                    "nombre": datos.nombre.strip(),
                    "correo": datos.correo.strip().lower(),
                    "telefono": datos.telefono.strip(),
                    "password_hash": password_hash
                }
            )

            id_usuario = resultado.lastrowid

            # 2. Crear perfil de vecino
            conexion.execute(
                text("""
                    INSERT INTO perfiles_vecino (
                        id_usuario
                    )
                    VALUES (
                        :id_usuario
                    )
                """),
                {
                    "id_usuario": id_usuario
                }
            )

            # 3. Guardar dirección
            conexion.execute(
                text("""
                    INSERT INTO direcciones (
                        id_usuario,
                        direccion,
                        barrio,
                        departamento_torre,
                        es_principal
                    )
                    VALUES (
                        :id_usuario,
                        :direccion,
                        :barrio,
                        :depto,
                        1
                    )
                """),
                {
                    "id_usuario": id_usuario,
                    "direccion": datos.direccion.strip(),
                    "barrio": datos.barrio.strip(),
                    "depto": datos.depto.strip() if datos.depto else None
                }
            )

        return {
            "mensaje": "Vecino registrado correctamente",
            "id_usuario": id_usuario,
            "nombre": datos.nombre,
            "correo": datos.correo.strip().lower(),
            "rol": "vecino"
        }

    except IntegrityError as error:
        raise HTTPException(
            status_code=409,
            detail="El correo electrónico ya está registrado"
        ) from error

    except Exception as error:
        print(f"ERROR AL REGISTRAR VECINO: {error}")

        raise HTTPException(
            status_code=500,
            detail="No se pudo completar el registro"
        ) from error


@app.post("/registro/profesional", status_code=201)
def registrar_profesional(datos: RegistroProfesional):

    try:
        password_hash = generar_hash(datos.password)

        with engine.begin() as conexion:

            # 1. Crear usuario
            resultado = conexion.execute(
                text("""
                    INSERT INTO usuarios (
                        nombre, correo, telefono,
                        contrasena_hash, rol
                    )
                    VALUES (
                        :nombre, :correo, :telefono,
                        :password_hash, 'profesional'
                    )
                """),
                {
                    "nombre": datos.nombre.strip(),
                    "correo": datos.correo.strip().lower(),
                    "telefono": datos.telefono.strip(),
                    "password_hash": password_hash
                }
            )

            id_usuario = resultado.lastrowid

            # 2. Crear perfil profesional
            resultado_perfil = conexion.execute(
                text("""
                    INSERT INTO perfiles_profesional (
                        id_usuario,
                        tipo_profesional,
                        nombre_publico,
                        especialidad,
                        anos_experiencia
                    )
                    VALUES (
                        :id_usuario,
                        :tipo_profesional,
                        :nombre_publico,
                        :especialidad,
                        :anos_experiencia
                    )
                """),
                {
                    "id_usuario": id_usuario,
                    "tipo_profesional": datos.tipo_profesional,
                    "nombre_publico": datos.nombre.strip(),
                    "especialidad": datos.especialidad.strip(),
                    "anos_experiencia": datos.anos_experiencia
                }
            )

            id_perfil_profesional = resultado_perfil.lastrowid

            # 3. Guardar datos de verificación
            conexion.execute(
                text("""
                    INSERT INTO verificaciones_profesional (
                        id_perfil_profesional,
                        rut,
                        tipo_comprobante,
                        institucion,
                        registro_publico,
                        referencia1_nombre,
                        referencia1_contacto,
                        referencia1_trabajo,
                        referencia2_nombre,
                        referencia2_contacto,
                        referencia2_trabajo,
                        portafolio
                    )
                    VALUES (
                        :id_perfil,
                        :rut,
                        :tipo_comprobante,
                        :institucion,
                        :registro_publico,
                        :ref1_nombre,
                        :ref1_contacto,
                        :ref1_trabajo,
                        :ref2_nombre,
                        :ref2_contacto,
                        :ref2_trabajo,
                        :portafolio
                    )
                """),
                {
                    "id_perfil": id_perfil_profesional,
                    "rut": datos.rut,
                    "tipo_comprobante": datos.tipo_comprobante,
                    "institucion": datos.institucion,
                    "registro_publico": datos.registro_publico,
                    "ref1_nombre": datos.ref1_nombre,
                    "ref1_contacto": datos.ref1_contacto,
                    "ref1_trabajo": datos.ref1_trabajo,
                    "ref2_nombre": datos.ref2_nombre,
                    "ref2_contacto": datos.ref2_contacto,
                    "ref2_trabajo": datos.ref2_trabajo,
                    "portafolio": datos.portafolio
                }
            )

            # 4. Guardar dirección
            conexion.execute(
                text("""
                    INSERT INTO direcciones (
                        id_usuario,
                        direccion,
                        barrio,
                        departamento_torre,
                        es_principal
                    )
                    VALUES (
                        :id_usuario,
                        :direccion,
                        :barrio,
                        :depto,
                        1
                    )
                """),
                {
                    "id_usuario": id_usuario,
                    "direccion": datos.direccion.strip(),
                    "barrio": datos.barrio.strip(),
                    "depto": datos.depto.strip() if datos.depto else None
                }
            )

        return {
            "mensaje": "Profesional registrado correctamente",
            "id_usuario": id_usuario,
            "nombre": datos.nombre,
            "correo": datos.correo.strip().lower(),
            "rol": "profesional",
            "especialidad": datos.especialidad
        }

    except IntegrityError as error:
        raise HTTPException(
            status_code=409,
            detail="El correo electrónico ya está registrado"
        ) from error

    except Exception as error:
        print(f"ERROR AL REGISTRAR PROFESIONAL: {error}")

        raise HTTPException(
            status_code=500,
            detail="No se pudo completar el registro"
        ) from error


@app.post("/profesionales/{id_usuario}/archivos")
async def subir_archivos_profesional(
    id_usuario: int,
    comprobante: UploadFile | None = File(default=None),
    fotos_trabajos: list[UploadFile] = File(default=[])
):
    archivos_guardados = []

    try:
        # 1. Buscar el perfil profesional
        with engine.connect() as conexion:
            perfil = conexion.execute(
                text("""
                    SELECT id_perfil_profesional
                    FROM perfiles_profesional
                    WHERE id_usuario = :id_usuario
                """),
                {"id_usuario": id_usuario}
            ).mappings().first()

        if not perfil:
            raise HTTPException(
                status_code=404,
                detail="No se encontró el perfil profesional"
            )

        # 2. Comprobar cantidad de fotografías
        if len(fotos_trabajos) > 6:
            raise HTTPException(
                status_code=400,
                detail="Solo se permiten 6 fotografías"
            )

        archivos = []

        if comprobante:
            archivos.append((comprobante, "certificado"))

        for foto in fotos_trabajos:
            archivos.append((foto, "fotografia_trabajo"))

        registros = []

        # 3. Validar y guardar archivos
        for archivo, tipo in archivos:
            extension = Path(archivo.filename or "").suffix.lower()

            if tipo == "certificado":
                extensiones = [".pdf", ".jpg", ".jpeg", ".png"]
            else:
                extensiones = [".jpg", ".jpeg", ".png"]

            if extension not in extensiones:
                raise HTTPException(
                    status_code=400,
                    detail="Formato de archivo no permitido"
                )

            contenido = await archivo.read(MAX_FILE_SIZE + 1)

            if len(contenido) > MAX_FILE_SIZE:
                raise HTTPException(
                    status_code=400,
                    detail="Cada archivo debe pesar como máximo 5 MB"
                )

            if not contenido:
                raise HTTPException(
                    status_code=400,
                    detail="No se permiten archivos vacíos"
                )

            nombre_guardado = f"{uuid.uuid4().hex}{extension}"
            ruta_archivo = UPLOAD_DIR / nombre_guardado

            with open(ruta_archivo, "wb") as destino:
                destino.write(contenido)

            archivos_guardados.append(ruta_archivo)

            registros.append({
                "tipo": tipo,
                "nombre": archivo.filename,
                "ruta": f"uploads/profesionales/{nombre_guardado}"
            })

        # 4. Registrar los archivos en MariaDB
        with engine.begin() as conexion:
            for registro in registros:
                conexion.execute(
                    text("""
                        INSERT INTO archivos_profesional (
                            id_perfil_profesional,
                            tipo_archivo,
                            nombre_archivo,
                            ruta_archivo
                        )
                        VALUES (
                            :id_perfil,
                            :tipo,
                            :nombre,
                            :ruta
                        )
                    """),
                    {
                        "id_perfil": perfil["id_perfil_profesional"],
                        "tipo": registro["tipo"],
                        "nombre": registro["nombre"],
                        "ruta": registro["ruta"]
                    }
                )

        return {
            "mensaje": "Archivos guardados correctamente",
            "cantidad": len(registros),
            "archivos": registros
        }

    except HTTPException:
        for ruta in archivos_guardados:
            ruta.unlink(missing_ok=True)
        raise

    except Exception as error:
        for ruta in archivos_guardados:
            ruta.unlink(missing_ok=True)

        print(f"ERROR AL GUARDAR ARCHIVOS: {error}")

        raise HTTPException(
            status_code=500,
            detail="No se pudieron guardar los archivos"
        ) from error


@app.post("/login")
def iniciar_sesion(datos: InicioSesion):

    identificador = datos.identificador.strip().lower()
    digitos = "".join(c for c in identificador if c.isdigit())

    try:
        with engine.connect() as conexion:

            usuario = conexion.execute(
                text("""
                    SELECT
                        u.id_usuario,
                        u.nombre,
                        u.correo,
                        u.telefono,
                        u.contrasena_hash,
                        u.rol,
                        u.estado,
                        u.fecha_registro,
                        d.direccion,
                        d.barrio,
                        d.departamento_torre,
                        pp.tipo_profesional,
                        pp.especialidad,
                        pp.estado_verificacion
                    FROM usuarios u
                    LEFT JOIN direcciones d
                        ON d.id_usuario = u.id_usuario
                        AND d.es_principal = 1
                    LEFT JOIN perfiles_profesional pp
                        ON pp.id_usuario = u.id_usuario
                    WHERE LOWER(u.correo) = :correo
                        OR (
                            :telefono <> ''
                            AND LENGTH(:telefono) >= 8
                            AND RIGHT(
                                REGEXP_REPLACE(u.telefono, '[^0-9]', ''),
                                9
                            ) = RIGHT(:telefono, 9)
                        )
                    LIMIT 1
                """),
                {
                    "correo": identificador,
                    "telefono": digitos
                }
            ).mappings().first()

        if not usuario or not verificar_password(
            datos.password,
            usuario["contrasena_hash"]
        ):
            raise HTTPException(
                status_code=401,
                detail="Correo/teléfono o contraseña incorrectos"
            )

        if usuario["estado"] == "bloqueado":
            return {
                "suspendido": True,
                "motivo": "Tu cuenta está bloqueada."
            }

        rol = {
            "vecino": "client",
            "profesional": "tech",
            "admin": "admin"
        }.get(usuario["rol"], "client")

        perfil = (
            usuario["tipo_profesional"]
            if rol == "tech"
            else "admin" if rol == "admin"
            else "vecino"
        )

        return {
            "id": usuario["id_usuario"],
            "nombre": usuario["nombre"],
            "correo": usuario["correo"],
            "telefono": usuario["telefono"],
            "direccion": usuario["direccion"],
            "barrio": usuario["barrio"],
            "depto": usuario["departamento_torre"],
            "rol": rol,
            "perfil": perfil,
            "tipoCuenta": {
                "client": "Vecino / Cliente",
                "tech": "Profesional",
                "admin": "Administrador"
            }[rol],
            "verificacion": {
                "estado": usuario["estado_verificacion"],
                "especialidad": usuario["especialidad"]
            } if rol == "tech" else None,
            "estado": usuario["estado"],
            "creadoEn": str(usuario["fecha_registro"])
        }

    except HTTPException:
        raise

    except Exception as error:
        print(f"ERROR AL INICIAR SESIÓN: {error}")

        raise HTTPException(
            status_code=500,
            detail="No se pudo completar el inicio de sesión"
        ) from error
