import hashlib
import os
import secrets
import uuid

from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Header, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
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


RADIOS_COBERTURA = (3, 5, 8, 10)
TARIFA_MAXIMA = 5_000_000
MAX_ETIQUETAS = 15


class PrivacidadPerfil(BaseModel):
    mostrar_whatsapp: bool = False
    ocultar_correo: bool = True


class NotificacionesPerfil(BaseModel):
    alertas_urgencia: bool = False


class ActualizarPerfilProfesional(BaseModel):
    nombre_publico: str = Field(min_length=1, max_length=100)
    # La especialidad verificada no se edita desde INT-08; se acepta y se ignora.
    especialidad: str | None = Field(default=None, max_length=100)
    descripcion: str = Field(default="", max_length=600)
    tarifa_visita: int | None = Field(default=None, ge=1, le=TARIFA_MAXIMA)
    tarifa_urgencia: int | None = Field(default=None, ge=1, le=TARIFA_MAXIMA)
    radio_cobertura_km: int | None = None
    etiquetas: list[str] = Field(default_factory=list, max_length=MAX_ETIQUETAS)
    privacidad: PrivacidadPerfil = Field(default_factory=PrivacidadPerfil)
    notificaciones: NotificacionesPerfil = Field(default_factory=NotificacionesPerfil)

    @field_validator("nombre_publico")
    @classmethod
    def validar_nombre_publico(cls, valor: str) -> str:
        valor = valor.strip()
        if not valor:
            raise ValueError("El nombre comercial no puede estar vacío")
        return valor

    @field_validator("descripcion")
    @classmethod
    def limpiar_descripcion(cls, valor: str) -> str:
        return valor.strip()

    @field_validator("radio_cobertura_km")
    @classmethod
    def validar_radio(cls, valor: int | None) -> int | None:
        if valor is not None and valor not in RADIOS_COBERTURA:
            raise ValueError("El radio de cobertura debe ser 3, 5, 8 o 10 km")
        return valor

    @field_validator("etiquetas")
    @classmethod
    def validar_etiquetas(cls, valores: list[str]) -> list[str]:
        limpias = []
        vistas = set()
        for valor in valores:
            etiqueta = " ".join(str(valor).split())
            if not etiqueta:
                continue
            if len(etiqueta) > 40:
                raise ValueError("Cada especialidad puede tener hasta 40 caracteres")
            clave = etiqueta.casefold()
            if clave in vistas:
                continue
            vistas.add(clave)
            limpias.append(etiqueta)
        return limpias


# ------------------------------------------
# Tokens de sesión (en Railway solo se guarda el hash SHA-256)
# ------------------------------------------

DURACION_SESION_DIAS = 7


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def token_desde_cabecera(authorization: str | None) -> str | None:
    if not authorization:
        return None
    esquema, _, token = authorization.partition(" ")
    token = token.strip()
    if esquema.lower() != "bearer" or not token or len(token) > 256:
        return None
    return token


def crear_sesion(id_usuario: int) -> str:
    token = secrets.token_urlsafe(32)
    with engine.begin() as conexion:
        conexion.execute(
            text("""
                INSERT INTO sesiones (id_usuario, token_hash, fecha_expiracion)
                VALUES (
                    :id_usuario,
                    :token_hash,
                    DATE_ADD(NOW(), INTERVAL :dias DAY)
                )
            """),
            {
                "id_usuario": id_usuario,
                "token_hash": hash_token(token),
                "dias": DURACION_SESION_DIAS
            }
        )
    return token


def profesional_desde_token(authorization: str | None) -> dict:
    token = token_desde_cabecera(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Sesión no válida")

    with engine.connect() as conexion:
        sesion = conexion.execute(
            text("""
                SELECT
                    u.id_usuario,
                    u.rol,
                    u.estado,
                    pp.id_perfil_profesional
                FROM sesiones s
                JOIN usuarios u ON u.id_usuario = s.id_usuario
                LEFT JOIN perfiles_profesional pp ON pp.id_usuario = u.id_usuario
                WHERE s.token_hash = :token_hash
                    AND s.fecha_revocacion IS NULL
                    AND s.fecha_expiracion > NOW()
                LIMIT 1
            """),
            {"token_hash": hash_token(token)}
        ).mappings().first()

    if not sesion:
        raise HTTPException(status_code=401, detail="Sesión no válida o expirada")
    if sesion["estado"] == "bloqueado":
        raise HTTPException(status_code=403, detail="La cuenta está bloqueada")
    if sesion["rol"] != "profesional" or sesion["id_perfil_profesional"] is None:
        raise HTTPException(status_code=403, detail="Solo disponible para cuentas profesionales")

    return dict(sesion)


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

        token = crear_sesion(usuario["id_usuario"])

        return {
            "token": token,
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


# ------------------------------------------
# Cerrar sesión: revoca el token en Railway
# ------------------------------------------

@app.post("/logout", status_code=204)
def cerrar_sesion(authorization: str | None = Header(default=None)):
    token = token_desde_cabecera(authorization)

    if token:
        try:
            with engine.begin() as conexion:
                conexion.execute(
                    text("""
                        UPDATE sesiones
                        SET fecha_revocacion = NOW()
                        WHERE token_hash = :token_hash
                            AND fecha_revocacion IS NULL
                    """),
                    {"token_hash": hash_token(token)}
                )
        except Exception as error:
            print(f"ERROR AL CERRAR SESIÓN: {error}")
            raise HTTPException(
                status_code=500,
                detail="No se pudo cerrar la sesión"
            ) from error

    return Response(status_code=204)


# ------------------------------------------
# INT-08: perfil del profesional autenticado
# ------------------------------------------

def leer_perfil_profesional(conexion, id_usuario: int, id_perfil: int) -> dict:
    perfil = conexion.execute(
        text("""
            SELECT
                u.nombre,
                pp.nombre_publico,
                pp.especialidad,
                pp.descripcion,
                pp.tarifa_visita,
                pp.tarifa_urgencia,
                pp.radio_cobertura_km,
                pp.estado_verificacion,
                d.barrio,
                COALESCE(pr.mostrar_whatsapp, 0) AS mostrar_whatsapp,
                COALESCE(pr.ocultar_correo, 1) AS ocultar_correo,
                COALESCE(n.alertas_urgencia, 0) AS alertas_urgencia
            FROM perfiles_profesional pp
            JOIN usuarios u ON u.id_usuario = pp.id_usuario
            LEFT JOIN direcciones d
                ON d.id_usuario = u.id_usuario
                AND d.es_principal = 1
            LEFT JOIN privacidad_profesional pr
                ON pr.id_perfil_profesional = pp.id_perfil_profesional
            LEFT JOIN notificaciones_profesional n
                ON n.id_perfil_profesional = pp.id_perfil_profesional
            WHERE pp.id_perfil_profesional = :id_perfil
                AND pp.id_usuario = :id_usuario
            LIMIT 1
        """),
        {"id_perfil": id_perfil, "id_usuario": id_usuario}
    ).mappings().first()

    if not perfil:
        raise HTTPException(status_code=404, detail="No se encontró el perfil profesional")

    etiquetas = conexion.execute(
        text("""
            SELECT etiqueta
            FROM etiquetas_profesional
            WHERE id_perfil_profesional = :id_perfil
            ORDER BY orden, id_etiqueta
        """),
        {"id_perfil": id_perfil}
    ).scalars().all()

    certificaciones = conexion.execute(
        text("""
            SELECT nombre, institucion, estado, fecha_vencimiento
            FROM certificaciones_profesional
            WHERE id_perfil_profesional = :id_perfil
            ORDER BY fecha_registro DESC, id_certificacion DESC
        """),
        {"id_perfil": id_perfil}
    ).mappings().all()

    return {
        "nombre_legal": perfil["nombre"],
        "nombre_publico": perfil["nombre_publico"] or "",
        "especialidad": perfil["especialidad"] or "",
        "descripcion": perfil["descripcion"] or "",
        "tarifa_visita": perfil["tarifa_visita"],
        "tarifa_urgencia": perfil["tarifa_urgencia"],
        "radio_cobertura_km": perfil["radio_cobertura_km"],
        "estado_verificacion": perfil["estado_verificacion"],
        "barrio": perfil["barrio"] or "",
        "etiquetas": list(etiquetas),
        "certificaciones": [
            {
                "nombre": c["nombre"],
                "institucion": c["institucion"] or "",
                "estado": c["estado"],
                "fecha_vencimiento": (
                    c["fecha_vencimiento"].isoformat()
                    if c["fecha_vencimiento"] else None
                )
            }
            for c in certificaciones
        ],
        "privacidad": {
            "mostrar_whatsapp": bool(perfil["mostrar_whatsapp"]),
            "ocultar_correo": bool(perfil["ocultar_correo"])
        },
        "notificaciones": {
            "alertas_urgencia": bool(perfil["alertas_urgencia"])
        }
    }


@app.get("/profesionales/me/perfil")
def obtener_mi_perfil(authorization: str | None = Header(default=None)):
    sesion = profesional_desde_token(authorization)

    try:
        with engine.connect() as conexion:
            return leer_perfil_profesional(
                conexion,
                sesion["id_usuario"],
                sesion["id_perfil_profesional"]
            )

    except HTTPException:
        raise

    except Exception as error:
        print(f"ERROR AL LEER PERFIL PROFESIONAL: {error}")
        raise HTTPException(
            status_code=500,
            detail="No se pudo cargar el perfil"
        ) from error


@app.put("/profesionales/me/perfil")
def actualizar_mi_perfil(
    datos: ActualizarPerfilProfesional,
    authorization: str | None = Header(default=None)
):
    sesion = profesional_desde_token(authorization)
    id_usuario = sesion["id_usuario"]
    id_perfil = sesion["id_perfil_profesional"]

    try:
        with engine.begin() as conexion:
            conexion.execute(
                text("""
                    UPDATE perfiles_profesional
                    SET
                        nombre_publico = :nombre_publico,
                        descripcion = :descripcion,
                        tarifa_visita = :tarifa_visita,
                        tarifa_urgencia = :tarifa_urgencia,
                        radio_cobertura_km = :radio
                    WHERE id_perfil_profesional = :id_perfil
                        AND id_usuario = :id_usuario
                """),
                {
                    "nombre_publico": datos.nombre_publico,
                    "descripcion": datos.descripcion or None,
                    "tarifa_visita": datos.tarifa_visita,
                    "tarifa_urgencia": datos.tarifa_urgencia,
                    "radio": datos.radio_cobertura_km,
                    "id_perfil": id_perfil,
                    "id_usuario": id_usuario
                }
            )

            conexion.execute(
                text("""
                    DELETE FROM etiquetas_profesional
                    WHERE id_perfil_profesional = :id_perfil
                """),
                {"id_perfil": id_perfil}
            )

            for orden, etiqueta in enumerate(datos.etiquetas):
                conexion.execute(
                    text("""
                        INSERT INTO etiquetas_profesional (
                            id_perfil_profesional, etiqueta, orden
                        )
                        VALUES (:id_perfil, :etiqueta, :orden)
                    """),
                    {"id_perfil": id_perfil, "etiqueta": etiqueta, "orden": orden}
                )

            conexion.execute(
                text("""
                    INSERT INTO privacidad_profesional (
                        id_perfil_profesional, mostrar_whatsapp, ocultar_correo
                    )
                    VALUES (:id_perfil, :mostrar_whatsapp, :ocultar_correo)
                    ON DUPLICATE KEY UPDATE
                        mostrar_whatsapp = VALUES(mostrar_whatsapp),
                        ocultar_correo = VALUES(ocultar_correo)
                """),
                {
                    "id_perfil": id_perfil,
                    "mostrar_whatsapp": int(datos.privacidad.mostrar_whatsapp),
                    "ocultar_correo": int(datos.privacidad.ocultar_correo)
                }
            )

            conexion.execute(
                text("""
                    INSERT INTO notificaciones_profesional (
                        id_perfil_profesional, alertas_urgencia
                    )
                    VALUES (:id_perfil, :alertas_urgencia)
                    ON DUPLICATE KEY UPDATE
                        alertas_urgencia = VALUES(alertas_urgencia)
                """),
                {
                    "id_perfil": id_perfil,
                    "alertas_urgencia": int(datos.notificaciones.alertas_urgencia)
                }
            )

            return leer_perfil_profesional(conexion, id_usuario, id_perfil)

    except HTTPException:
        raise

    except Exception as error:
        print(f"ERROR AL ACTUALIZAR PERFIL PROFESIONAL: {error}")
        raise HTTPException(
            status_code=500,
            detail="No se pudo guardar el perfil"
        ) from error
