from dash import Dash, html

from dash_extensions_pkg import BeforeAfter

app = Dash()
app.layout = html.Div(
    [
        BeforeAfter(
            before="assets/lena_bw.png",
            after="assets/lena_color.png",
            width=512,
            height=512,
        )
    ]
)

if __name__ == "__main__":
    app.run_server()
