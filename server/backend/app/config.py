from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    navidrome_url: str
    navidrome_username: str = ""
    navidrome_password: str = ""
    multi_user: bool = True
    accounts_file: str = "/config/accounts.json"
    app_api_key: str | None = None
    qoget_config: str = "/data/config/qoget/config.json"
    qoget_directory: str = "/music"
    network_db: str = "/data/network.sqlite3"
    navidrome_path_prefix: str = ""
    music_trash_directory: str = "/trash"
    music_library_directory: str = "/library"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
