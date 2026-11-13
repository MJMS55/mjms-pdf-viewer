<?php
declare(strict_types=1);
namespace OCP {
    interface IRequest {}
    interface IUserSession { public function getUser(); }
}
namespace OCP\App { interface IAppManager { public function isEnabledForUser($id, $user): bool; } }
namespace OCP\AppFramework {
    class Controller { public function __construct($name, $request) {} }
}
namespace OCP\AppFramework\Http {
    class JSONResponse {
        public function __construct(public $data, public $status, public $headers) {}
    }
}
namespace {
    require __DIR__ . '/../lib/Controller/IntegrationController.php';
    $request = new class implements \OCP\IRequest {};
    foreach ([true, false, null] as $enabled) {
        $user = $enabled === null ? null : (object)['uid' => 'test-user'];
        $session = new class($user) implements \OCP\IUserSession {
            public function __construct(private $user) {}
            public function getUser() { return $this->user; }
        };
        $apps = new class($enabled, $user) implements \OCP\App\IAppManager {
            public int $calls = 0;
            public function __construct(private $enabled, private $user) {}
            public function isEnabledForUser($id, $user): bool {
                if ($id !== 'mjms_pdf_manager' || $user !== $this->user) throw new \Exception('Wrong app/user');
                $this->calls++;
                return $this->enabled;
            }
        };
        $controller = new \OCA\MJMSPdfViewer\Controller\IntegrationController($request, $apps, $session);
        $response = $controller->managerState();
        if ($response->data !== ['enabled' => $enabled === true] || $response->headers['Cache-Control'] !== 'no-store'
            || $apps->calls !== ($user === null ? 0 : 1)) throw new \Exception('Incorrect state');
        echo 'PASS manager ' . var_export($enabled, true) . PHP_EOL;
    }
    $method = new \ReflectionMethod($controller, 'managerState');
    $attrs = array_map(fn($a) => $a->getName(), $method->getAttributes());
    if (in_array('OCP\\AppFramework\\Http\\Attribute\\PublicPage', $attrs, true)) throw new \Exception('Must require authentication');
    $routes = require __DIR__ . '/../appinfo/routes.php';
    if ($routes['routes'][0]['name'] !== 'integration#managerState' || $routes['routes'][0]['verb'] !== 'GET') throw new \Exception('Wrong route');
    echo "PASS route and authenticated controller\n";
}
